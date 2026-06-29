import { z } from "zod";
import Groq from "groq-sdk";

/**
 * Unified LLM extraction layer — supports three providers, selected via
 * LLM_PROVIDER env var:
 *
 *   "groq"   (default if GROQ_API_KEY is set) — hosted Llama via Groq's
 *            API, free tier, no GPU usage, very fast. Best for most cases.
 *
 *   "ollama" (default if no GROQ_API_KEY) — local Llama via Ollama,
 *            free but uses your GPU. Good for offline/private research.
 *
 *   "none"   — disables LLM entirely, all agents use heuristic fallback.
 *
 * Every agent treats LLM extraction as OPTIONAL — if extractStructured()
 * returns null for any reason, the agent falls back to its existing
 * heuristic extraction automatically. This mirrors the "degrade
 * gracefully, never crash" policy used throughout the codebase.
 *
 * LLM RESULT CACHING:
 * Extracted JSON is cached in memory per (prompt + content) hash for
 * the duration of a process run. This means re-running research on the
 * same company in the same session skips redundant LLM calls — useful
 * during development and for Watchlist auto-refresh where the same
 * company might be re-checked multiple times in a session.
 *
 * Env vars:
 *   LLM_PROVIDER  — "groq" | "ollama" | "none" (auto-detected if unset)
 *   GROQ_API_KEY  — required for Groq provider (free at console.groq.com)
 *   GROQ_MODEL    — default "llama-3.1-8b-instant"
 *   OLLAMA_URL    — default http://localhost:11434
 *   OLLAMA_MODEL  — default llama3.1:8b
 */

// --- Config ---
const LLM_PROVIDER = process.env.LLM_PROVIDER ??
  (process.env.GROQ_API_KEY ? "groq" : "ollama");

const GROQ_MODEL   = process.env.GROQ_MODEL   ?? "llama-3.1-8b-instant";
const OLLAMA_URL   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

// --- Cache ---
// Capped at 100 entries — enough for a full session of research runs
// without growing unbounded in long-running processes.
const MAX_CACHE_SIZE = 100;
const extractionCache = new Map<string, unknown>();

function cacheKey(systemPrompt: string, userContent: string): string {
  // Simple hash — good enough for dev/session caching, not cryptographic
  const str = `${systemPrompt}|||${userContent}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return `${hash}`;
}

function cacheSet(key: string, value: unknown): void {
  if (extractionCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (Map preserves insertion order)
    extractionCache.delete(extractionCache.keys().next().value!);
  }
  extractionCache.set(key, value);
}

// --- GPU serialization queue (Ollama only) ---
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queueTail.then(async () => {
    // Small pause between LLM calls to stay under TPM limits on free tier
    await new Promise(r => setTimeout(r, 1500));
    return task();
  }, task);
  queueTail = result.catch(() => undefined);
  return result;
}

// --- Ollama availability ---
let ollamaAvailable: boolean | null = null;
export async function isOllamaAvailable(): Promise<boolean> {
  if (ollamaAvailable === true) return true;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    ollamaAvailable = res.ok;
    if (!res.ok) console.error(`[llm] Ollama HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error(`[llm] Ollama unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// --- Groq provider ---
async function extractViaGroq<T>(
  systemPrompt: string,
  userContent: string,
  schema: z.ZodType<T>,
  retryCount = 0
): Promise<T | null> {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `${systemPrompt}\n\nIMPORTANT: Only extract facts explicitly present in the provided text. Never guess or invent information. Omit any field you're not confident about. Respond with ONLY valid JSON, no other text, no markdown backticks.`,
        },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) { console.error("[llm:groq] No content in response"); return null; }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { console.error(`[llm:groq] Invalid JSON: ${raw.slice(0, 200)}`); return null; }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      console.error(`[llm:groq] Schema mismatch: ${result.error.message.slice(0, 300)}`);
      return null;
    }
    return result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Rate limit — parse retry-after and wait
    if (message.includes("429") && retryCount < 3) {
      const secondsMatch = message.match(/try again in ([\d.]+)s/);
      const waitMs = secondsMatch
        ? Math.ceil(parseFloat(secondsMatch[1]) * 1000) + 500
        : (retryCount + 1) * 8000;
      console.error(`[llm:groq] Rate limited — waiting ${Math.round(waitMs / 1000)}s before retry ${retryCount + 1}/3`);
      await new Promise(r => setTimeout(r, waitMs));
      return extractViaGroq(systemPrompt, userContent, schema, retryCount + 1);
    }

    console.error(`[llm:groq] Error: ${message}`);
    return null;
  }
}

// --- Ollama provider ---
async function extractViaOllama<T>(
  systemPrompt: string,
  userContent: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  if (!(await isOllamaAvailable())) return null;

  return enqueue(async () => {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          system: `${systemPrompt}\n\nIMPORTANT: Only extract facts explicitly present in the provided text. Never guess or invent information. Omit any field you're not confident about. Respond with ONLY valid JSON, no other text.`,
          prompt: userContent,
          format: "json",
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[llm:ollama] HTTP ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }

      const data = (await res.json()) as { response?: string };
      if (!data.response) { console.error("[llm:ollama] No response field"); return null; }

      let parsed: unknown;
      try { parsed = JSON.parse(data.response); }
      catch { console.error(`[llm:ollama] Invalid JSON: ${data.response.slice(0, 200)}`); return null; }

      const result = schema.safeParse(parsed);
      if (!result.success) {
        console.error(`[llm:ollama] Schema mismatch: ${result.error.message.slice(0, 300)}`);
        return null;
      }
      return result.data;
    } catch (err) {
      console.error(`[llm:ollama] Error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });
}

// --- Public API ---

/**
 * Extract structured data from text using the configured LLM provider.
 * Results are cached per (systemPrompt + userContent) for the session.
 * Returns null on any failure — callers always fall back to heuristics.
 */
export async function extractStructured<T>(
  systemPrompt: string,
  userContent: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  if (LLM_PROVIDER === "none") return null;

  const key = cacheKey(systemPrompt, userContent);
  if (extractionCache.has(key)) {
    const cached = extractionCache.get(key);
    const result = schema.safeParse(cached);
    return result.success ? result.data : null;
  }

  let result: T | null = null;

  if (LLM_PROVIDER === "groq") {
    result = await extractViaGroq(systemPrompt, userContent, schema);
    // Fall back to Ollama if Groq fails and Ollama is available
    if (!result) result = await extractViaOllama(systemPrompt, userContent, schema);
  } else {
    result = await extractViaOllama(systemPrompt, userContent, schema);
  }

  if (result !== null) cacheSet(key, result);
  return result;
}

// --- Schemas ---

// --- Schema helpers ---
// Rather than trying to enumerate every shape an LLM might return,
// accept `unknown` for complex fields and normalize in a transform.
// This is more robust than nested z.union() which breaks in Zod v4
// when unions are nested inside arrays.

function toStringOrUndefined(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(String).join(", ") || undefined;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(String).join(" / ") || undefined;
  return String(v);
}

function toStringArray(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item === "object" && item !== null) return Object.values(item as Record<string, unknown>).join(" ");
    return String(item);
  }).filter(Boolean);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(String).filter(Boolean);
  return [];
}

function toLeadershipArray(v: unknown): { name: string; title: string }[] {
  if (!v) return [];
  const items = Array.isArray(v) ? v : [v];
  return items.flatMap((item) => {
    if (typeof item === "string") {
      const [name, ...rest] = item.split(/\s*[—\-–:,|]\s*/);
      if (!name?.trim()) return [];
      return [{ name: name.trim(), title: rest.join(" ").trim() || "Unknown" }];
    }
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const name = String(obj.name ?? obj.fullName ?? obj.person ?? "").trim();
      const title = String(obj.title ?? obj.role ?? obj.position ?? "Unknown").trim();
      if (!name) return [];
      return [{ name, title }];
    }
    return [];
  });
}

function toProductArray(v: unknown): { name: string; description?: string }[] {
  if (!v) return [];
  const items = Array.isArray(v) ? v : [v];
  return items.flatMap((item) => {
    if (typeof item === "string") return item ? [{ name: item }] : [];
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const name = String(obj.name ?? obj.product ?? "").trim();
      if (!name) return [];
      return [{ name, description: obj.description ? String(obj.description) : undefined }];
    }
    return [];
  });
}

function toSpecArray(v: unknown): { label: string; value: string }[] {
  if (!v) return [];
  const items = Array.isArray(v) ? v : [v];
  return items.flatMap((item) => {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const label = String(obj.label ?? obj.name ?? obj.key ?? "").trim();
      const value = String(obj.value ?? obj.val ?? "").trim();
      if (!label) return [];
      return [{ label, value }];
    }
    return [];
  });
}

function toCompetitorArray(v: unknown): { name: string; note?: string }[] {
  if (!v) return [];
  const items = Array.isArray(v) ? v : [v];
  return items.flatMap((item) => {
    if (typeof item === "string") return item ? [{ name: item }] : [];
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const name = String(obj.name ?? obj.product ?? obj.company ?? "").trim();
      if (!name) return [];
      return [{ name, note: obj.note ? String(obj.note) : undefined }];
    }
    return [];
  });
}

// --- Permissive base schema: accept any JSON object ---
const AnyObject = z.record(z.string(), z.unknown());

export const CompanyExtractionSchema = AnyObject.transform((obj) => ({
  description: toStringOrUndefined(obj.description),
  founded: toStringOrUndefined(obj.founded),
  headquarters: toStringOrUndefined(obj.headquarters),
  industry: toStringOrUndefined(obj.industry),
  leadership: toLeadershipArray(obj.leadership),
  products: toProductArray(obj.products),
}));
export type CompanyExtraction = z.infer<typeof CompanyExtractionSchema>;

export const FundingExtractionSchema = AnyObject.transform((obj) => {
  const rawFunding = Array.isArray(obj.funding) ? obj.funding : [];
  return {
    funding: rawFunding.map((f: unknown) => {
      const item = (typeof f === "object" && f !== null ? f : {}) as Record<string, unknown>;
      return {
        round: toStringOrUndefined(item.round),
        amount: toStringOrUndefined(item.amount),
        date: toStringOrUndefined(item.date),
      };
    }),
    ownership: toStringOrUndefined(obj.ownership),
  };
});
export type FundingExtraction = z.infer<typeof FundingExtractionSchema>;

export const CompetitorExtractionSchema = AnyObject.transform((obj) => ({
  competitors: toCompetitorArray(obj.competitors),
}));
export type CompetitorExtraction = z.infer<typeof CompetitorExtractionSchema>;

export const PersonExtractionSchema = AnyObject.transform((obj) => ({
  summary: toStringOrUndefined(obj.summary),
  currentRole: toStringOrUndefined(obj.currentRole ?? obj.role ?? obj.current_role),
  currentCompany: toStringOrUndefined(obj.currentCompany ?? obj.company ?? obj.current_company),
  careerHistory: (() => {
    const raw = obj.careerHistory ?? obj.career_history ?? obj.career;
    if (!raw) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items.flatMap((item: unknown) => {
      if (typeof item === "string") {
        const [title, company] = item.split(/\s*[—\-–:@]\s*/);
        return title?.trim() ? [{ title: title.trim(), company: company?.trim() }] : [];
      }
      if (typeof item === "object" && item !== null) {
        const o = item as Record<string, unknown>;
        const title = String(o.title ?? o.role ?? o.position ?? "").trim();
        const company = toStringOrUndefined(o.company ?? o.organization ?? o.employer);
        return title ? [{ title, company }] : [];
      }
      return [];
    });
  })(),
}));
export type PersonExtraction = z.infer<typeof PersonExtractionSchema>;

export const RisksOpportunitiesSchema = AnyObject.transform((obj) => ({
  risks: toStringArray(obj.risks),
  opportunities: toStringArray(obj.opportunities),
}));
export type RisksOpportunities = z.infer<typeof RisksOpportunitiesSchema>;

export const ProductEntityExtractionSchema = AnyObject.transform((obj) => ({
  description: toStringOrUndefined(obj.description),
  brand: toStringOrUndefined(obj.brand ?? obj.manufacturer ?? obj.make),
  category: toStringOrUndefined(obj.category ?? obj.type ?? obj.segment),
  price: toStringOrUndefined(obj.price ?? obj.starting_price ?? obj.msrp),
  specs: toSpecArray(obj.specs ?? obj.specifications ?? obj.features),
  competitors: toCompetitorArray(obj.competitors ?? obj.alternatives ?? obj.competing_products),
}));
export type ProductEntityExtraction = z.infer<typeof ProductEntityExtractionSchema>;
