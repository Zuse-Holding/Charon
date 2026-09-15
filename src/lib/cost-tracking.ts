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
}

const storage = new AsyncLocalStorage<CostContext>();

/**
 * Wraps a research/deep-dive run. Every recordLlmUsage() call made by
 * anything invoked within fn() (however deep) gets attributed here.
 * Returns null for totalCostUsd only if zero LLM calls were tracked
 * (e.g. an easter-egg report that never touched an LLM) — distinct from
 * a real $0 total (Ollama/free-model-only run), which returns 0.
 */
export async function withCostTracking<T>(
  fn: () => Promise<T>
): Promise<{ result: T; totalCostUsd: number | null; calls: LlmCallUsage[] }> {
  const ctx: CostContext = { calls: [] };
  const result = await storage.run(ctx, fn);
  const totalCostUsd = ctx.calls.length === 0 ? null : ctx.calls.reduce(
    (sum, c) => sum + costForCall(c.model, c.promptTokens, c.completionTokens),
    0
  );
  return { result, totalCostUsd, calls: ctx.calls };
}

/**
 * Called from src/lib/llm.ts's three provider functions after every real
 * API response. A no-op outside a withCostTracking() context (e.g. the
 * CLI's research command, or diagnose-ollama.ts) — costs simply aren't
 * tracked there, which is fine; nothing reads a cost for those paths.
 */
export function recordLlmUsage(usage: LlmCallUsage): void {
  const ctx = storage.getStore();
  if (ctx) ctx.calls.push(usage);
}
