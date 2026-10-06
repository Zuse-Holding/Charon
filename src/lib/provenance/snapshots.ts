import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * Raw-response capture for provenance (Feature 2). Every agent already
 * fetches through the global fetch(), so one wrapper records the body of
 * every source response made during a research run, without touching 20+
 * agents. Same AsyncLocalStorage pattern as src/lib/cost-tracking.ts: a
 * run's recordings stay separate from concurrent runs for other users.
 *
 * Only source traffic is recorded. LLM providers, our own database,
 * analytics and email are excluded: they aren't records a finding can
 * come from.
 */

export interface Snapshot {
  /** SHA-256 of the full body, hex. Also the snapshot's identity. */
  sha256: string;
  /** Request URL with credential-like query parameters redacted. */
  url: string;
  host: string;
  retrievedAt: string;
  status: number;
  contentType: string | null;
  body: string;
  /** True for a stand-in record of what an AI step produced when no
   *  fetched source contained the claim (see findings.ts). */
  generated?: boolean;
}

const EXCLUDED_HOSTS = [
  "openrouter.ai", "api.groq.com", "api.anthropic.com",  // LLM providers
  "supabase.co", "posthog.com", "api.resend.com", "api.stripe.com",  // our own infrastructure
  "localhost", "127.0.0.1",  // Ollama and local services
];
const SECRET_PARAMS = /^(key|api_?key|apikey|token|access_?token|auth|secret|signature|sig|subscription[-_]?key)$/i;
const MAX_STORED_BODY = 5 * 1024 * 1024;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isExcluded(host: string): boolean {
  return EXCLUDED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Drop credential-like query parameters so stored URLs never carry keys. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.test(k)) u.searchParams.set(k, "REDACTED");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

interface RecordingContext {
  snapshots: Snapshot[];
}

const storage = new AsyncLocalStorage<RecordingContext>();
let installed = false;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Wraps global fetch once per process. Outside a recording context the
 *  wrapper is a pass-through, so normal (flag-off) runs behave exactly
 *  as before. */
export function installFetchRecorder(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await original(input, init);
    const ctx = storage.getStore();
    if (!ctx) return res;
    try {
      const url = requestUrl(input);
      const host = new URL(url).hostname;
      if (isExcluded(host)) return res;
      const body = await res.clone().text();
      ctx.snapshots.push({
        sha256: sha256(body),
        url: redactUrl(url),
        host,
        retrievedAt: new Date().toISOString(),
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: body.length > MAX_STORED_BODY ? body.slice(0, MAX_STORED_BODY) : body,
      });
    } catch {
      // Recording must never break the request it observes.
    }
    return res;
  };
}

/**
 * Runs fn, recording every source response it makes when enabled.
 * Disabled = fn runs untouched and snapshots is null.
 */
export async function recordSnapshots<T>(
  enabled: boolean,
  fn: () => Promise<T>,
): Promise<{ value: T; snapshots: Snapshot[] | null }> {
  if (!enabled) return { value: await fn(), snapshots: null };
  installFetchRecorder();
  const ctx: RecordingContext = { snapshots: [] };
  const value = await storage.run(ctx, fn);
  return { value, snapshots: ctx.snapshots };
}
