import { AsyncLocalStorage } from "node:async_hooks";
import { costForCall } from "./model-pricing.js";

/**
 * Per-run LLM cost accumulator (task C, pre-launch). A single research run
 * fans out across many agents (website, news, competitor, corporate,
 * people, product, synthesis, ...), each independently calling
 * extractStructured() in src/lib/llm.ts — threading a cost accumulator
 * through every one of those function signatures would touch 20+ files
 * for what's fundamentally request-scoped bookkeeping. AsyncLocalStorage
 * gives every LLM call made anywhere in a run's async call graph implicit
 * access to that run's accumulator, keyed correctly even when
 * server/agent-server.ts handles multiple concurrent requests from
 * different users (a plain module-level variable would leak one user's
 * token usage into another's total under concurrency).
 */
export interface LlmCallUsage {
  provider: "groq" | "openrouter" | "ollama";
  model: string;
  promptTokens: number;
  completionTokens: number;
}

interface CostContext {
  calls: LlmCallUsage[];
  /** Real (uncached) Serper requests made in this run (Fix 6). */
  searchCalls: number;
  /** extractStructured() calls that failed on every provider (Fix 6). */
  llmFailures: number;
  /** Skip the source cache: the user asked for fresh sources (Fix 3). */
  refresh: boolean;
}

/** Serper's price per search credit ($50 / 50,000 on the standard plan). */
export const SEARCH_COST_USD = Number(process.env.SERPER_COST_PER_CALL ?? 0.001);

const storage = new AsyncLocalStorage<CostContext>();

/**
 * Wraps a research/deep-dive run. Every recordLlmUsage() call made by
 * anything invoked within fn() (however deep) gets attributed here.
 * Returns null for totalCostUsd only if zero LLM calls were tracked
 * (e.g. an easter-egg report that never touched an LLM) — distinct from
 * a real $0 total (Ollama/free-model-only run), which returns 0.
 */
export async function withCostTracking<T>(
  fn: () => Promise<T>,
  options: { refresh?: boolean } = {}
): Promise<{ result: T; totalCostUsd: number | null; modelCostUsd: number; calls: LlmCallUsage[]; searchCalls: number; llmFailures: number }> {
  const ctx: CostContext = { calls: [], searchCalls: 0, llmFailures: 0, refresh: options.refresh ?? false };
  const result = await storage.run(ctx, fn);
  const modelCost = ctx.calls.reduce(
    (sum, c) => sum + costForCall(c.model, c.promptTokens, c.completionTokens),
    0
  );
  const totalCostUsd = ctx.calls.length === 0 && ctx.searchCalls === 0 ? null : modelCost + ctx.searchCalls * SEARCH_COST_USD;
  return { result, totalCostUsd, modelCostUsd: modelCost, calls: ctx.calls, searchCalls: ctx.searchCalls, llmFailures: ctx.llmFailures };
}

/** One real Serper request (cache hits don't count). */
export function recordSearchCall(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.searchCalls++;
}

/** An LLM extraction that failed on every provider. */
export function recordLlmFailure(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.llmFailures++;
}

/** True when this run should bypass the source cache. */
export function isRefreshRun(): boolean {
  return storage.getStore()?.refresh ?? false;
}

/**
 * Called from src/lib/llm.ts's three provider functions after every real
 * API response. A no-op outside a withCostTracking() context (e.g. the
 * CLI's research command, or diagnose-ollama.ts) — costs simply aren't
 * tracked there, which is fine; nothing reads a cost for those paths.
 */
export function recordLlmUsage(usage: LlmCallUsage): void {
  // Which provider and model served each call (Fix 6): a silent fallback
  // between providers is itself a cause of run-to-run differences.
  console.log(`[llm] served by ${usage.provider}/${usage.model} (${usage.promptTokens}+${usage.completionTokens} tokens)`);
  const ctx = storage.getStore();
  if (ctx) ctx.calls.push(usage);
}

/** The cost-split columns (model_cost_usd, search_calls) as written per run. */
export interface CostSplit {
  model_cost_usd?: number | null;
  search_calls?: number;
}

let splitColumnsMissing = false;

/** PostgREST's "column not in the schema cache" or Postgres's undefined column. */
function isMissingColumn(err: { code?: string; message?: string }): boolean {
  return err.code === "PGRST204" || err.code === "42703" || /model_cost_usd|search_calls/.test(err.message ?? "");
}

/**
 * Writes a run row with its cost split, and again without it if the
 * database doesn't have those columns yet (the migration in
 * supabase/schema.sql not run): a report is never lost over cost logging.
 */
export async function writeWithCostSplit<R extends { error: { code?: string; message?: string } | null }>(
  split: CostSplit,
  write: (split: CostSplit) => PromiseLike<R>,
): Promise<R> {
  if (splitColumnsMissing) return write({});
  const first = await write(split);
  if (!first.error || !isMissingColumn(first.error)) return first;
  splitColumnsMissing = true;
  console.warn("[cost-tracking] model_cost_usd/search_calls columns missing; run the cost-split migration in supabase/schema.sql");
  return write({});
}
