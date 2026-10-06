import { AsyncLocalStorage } from "node:async_hooks";
import { deepLink, sourceById, sourcesFor, type Category, type ReportKind, type SourceDef } from "./registry.js";

/**
 * Records what happened at each source during a research run (Feature 1),
 * so "nothing found" is never confused with "never looked" or "failed".
 *
 * Agents swallow their own errors and return empty results, so an empty
 * result alone can't tell "no matches" from "the API was down". The
 * recorder watches each source's own requests: a 5xx, a 429, a network
 * error or a timeout with nothing returned is an Error, never "no results".
 */

export type CoverageStatus = "results" | "no_results" | "not_searched" | "error";

export interface CoverageEntry {
  id: string;
  name: string;
  jurisdiction: string;
  category: Category;
  status: CoverageStatus;
  /** What was searched for (or would be, for a skipped source). */
  query: string;
  /** results: how many items the source returned. */
  count?: number;
  /** results: the report section they appear in. */
  section?: string;
  /** not_searched: why. error: what went wrong. */
  reason?: string;
  /** not_searched: a link to run the search by hand. */
  url?: string;
}

export const DEFAULT_TIMEOUT_MS = 90_000;

interface SourceContext {
  hosts: string[];
  failures: string[];
}

const storage = new AsyncLocalStorage<SourceContext>();
let installed = false;

function hostMatches(host: string, hosts: string[]): boolean {
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function hostOf(input: Parameters<typeof fetch>[0]): string {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Wraps global fetch once. Outside a source context it's a pass-through. */
function installFailureWatcher(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const ctx = storage.getStore();
    const host = ctx ? hostOf(input) : "";
    const watched = ctx !== undefined && hostMatches(host, ctx.hosts);
    try {
      const res = await original(input, init);
      if (watched && (res.status >= 500 || res.status === 429)) ctx!.failures.push(`${host} returned ${res.status}`);
      return res;
    } catch (err) {
      if (watched) ctx!.failures.push(`${host}: ${err instanceof Error ? err.message : "request failed"}`);
      throw err;
    }
  };
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`No response after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function entry(s: SourceDef, status: CoverageStatus, query: string, extra: Partial<CoverageEntry> = {}): CoverageEntry {
  return { id: s.id, name: s.name, jurisdiction: s.jurisdiction, category: s.category, status, query, ...extra };
}

export class CoverageRecorder {
  private readonly entries = new Map<string, CoverageEntry>();

  constructor(
    readonly enabled: boolean,
    private readonly report: ReportKind,
    private readonly query: string,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Runs one source. Disabled: fn runs exactly as before (no timeout, no
   * watching). Enabled: a timeout, a throw or a failed request with
   * nothing returned is recorded as an error and `empty` is used instead,
   * so one failing source never breaks the report.
   */
  async run<T>(id: string, fn: () => Promise<T>, empty: T, count: (value: T) => number, query = this.query): Promise<T> {
    if (!this.enabled) return fn();
    const s = sourceById(id);
    const missing = (s.requiresEnv ?? []).filter((k) => !this.env[k]);
    if (missing.length > 0) {
      this.entries.set(id, entry(s, "error", query, { reason: "Source isn't configured on the server." }));
      return empty;
    }
    installFailureWatcher();
    const ctx: SourceContext = { hosts: s.hosts ?? [], failures: [] };
    let value: T;
    try {
      value = await storage.run(ctx, () => withTimeout(fn(), this.timeoutMs));
    } catch (err) {
      const reason = err instanceof TimeoutError ? `Timed out. ${err.message}.` : `Failed: ${err instanceof Error ? err.message : "unknown error"}.`;
      this.entries.set(id, entry(s, "error", query, { reason }));
      return empty;
    }
    const n = count(value);
    if (n > 0) this.entries.set(id, entry(s, "results", query, { count: n, section: s.section }));
    else if (ctx.failures.length > 0) this.entries.set(id, entry(s, "error", query, { reason: `Request failed: ${ctx.failures[0]}.` }));
    else this.entries.set(id, entry(s, "no_results", query));
    return value;
  }

  /** A source this run deliberately didn't search (plan, missing input). */
  skip(id: string, reason: string, query = this.query): void {
    if (!this.enabled) return;
    const s = sourceById(id);
    this.entries.set(id, entry(s, "not_searched", query, { reason, url: deepLink(s, query) }));
  }

  /** Every source for this report type, in registry order. Sources that
   *  weren't run or skipped explicitly are listed as not searched, so no
   *  source is ever left out. */
  result(): CoverageEntry[] | undefined {
    if (!this.enabled) return undefined;
    return sourcesFor(this.report, this.env).map((s) =>
      this.entries.get(s.id) ??
      entry(s, "not_searched", this.query, {
        reason: s.reason ?? "Not searched in this report.",
        url: deepLink(s, this.query),
      }));
  }
}
