import { NextRequest, NextResponse } from "next/server";

/**
 * Charon Research Chat — Hardened Route
 *
 * Security measures:
 *   - Rate limiting: 10 requests / IP / minute (in-memory, resets on restart)
 *   - Message length cap: 500 chars
 *   - History cap: 6 turns (12 messages max sent to LLM)
 *   - Request body size cap: 16KB
 *   - Input sanitization: strips control characters
 *   - No secrets exposed in error responses
 */

// ── Rate limiter (in-memory, per IP) ──────────────────────────────────
const RATE_LIMIT = 10;        // max requests
const RATE_WINDOW = 60_000;   // per 1 minute (ms)

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true };
}

// Clean up old entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 300_000);

// ── Constants ─────────────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_TURNS  = 6;    // 6 user + 6 assistant = 12 messages
const MAX_BODY_BYTES     = 16_384; // 16KB

const GROQ_API   = "https://api.groq.com/openai/v1/chat/completions";
const SERPER_API = "https://google.serper.dev/search";

const SYSTEM = `You are the Charon Research Module — a sharp, operator-grade market and business intelligence agent built by Zuse Holdings, powered by Selene.

You specialize in:
- Market sizing and opportunity analysis
- Competitive landscape mapping
- Industry trend signals
- Business model evaluation
- Go-to-market strategy insights

Response style: direct, signal-dense, no filler. Use markdown for structure. Ground every claim in the search results provided. 2–4 paragraphs max per response.`;

// ── Helpers ───────────────────────────────────────────────────────────
function sanitize(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars
    .trim();
}

function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

async function searchSerper(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch(SERPER_API, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query.slice(0, 200), num: 5 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const organic = (data.organic ?? []) as Array<{ title: string; snippet: string; link: string }>;
    return organic
      .slice(0, 4)
      .map((r) => `[${r.title}]\n${r.snippet}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

// ── Handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Rate limit
  const ip = getIP(req);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter ?? 60) },
      }
    );
  }

  // 2. Body size guard
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  // 3. Parse + validate body
  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "message required." }, { status: 400 });
  }

  // 4. Sanitize + cap message
  const message = sanitize(body.message).slice(0, MAX_MESSAGE_LENGTH);
  if (!message) {
    return NextResponse.json({ error: "Message is empty after sanitization." }, { status: 400 });
  }

  // 5. Validate + cap history
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: Message[] = rawHistory
    .filter(
      (m): m is Message =>
        typeof m === "object" &&
        m !== null &&
        (m as Message).role === "user" || (m as Message).role === "assistant" &&
        typeof (m as Message).content === "string"
    )
    .slice(-MAX_HISTORY_TURNS * 2) // last N turns
    .map((m) => ({
      role: m.role,
      content: sanitize(m.content).slice(0, MAX_MESSAGE_LENGTH * 2),
    }));

  // 6. Keys
  const groqKey   = process.env.GROQ_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (!groqKey) {
    console.error("[research-chat] GROQ_API_KEY not set");
    return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  }

  // 7. Web search (best-effort, non-blocking failure)
  let searchContext = "";
  if (serperKey) {
    searchContext = await searchSerper(message, serperKey);
  }

  // 8. Build LLM messages
  const userContent = searchContext
    ? `${message}\n\n[Search context]\n${searchContext}`
    : message;

  const messages = [
    { role: "system" as const, content: SYSTEM },
    ...history,
    { role: "user" as const, content: userContent },
  ];

  // 9. Call Groq
  try {
    const groqRes = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        messages,
        max_tokens: 800,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!groqRes.ok) {
      console.error(`[research-chat] Groq ${groqRes.status}`);
      return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content ?? "No response.";

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[research-chat] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  }
}

// Block all other methods
export async function GET()    { return NextResponse.json({ error: "Method not allowed." }, { status: 405 }); }
export async function PUT()    { return NextResponse.json({ error: "Method not allowed." }, { status: 405 }); }
export async function DELETE() { return NextResponse.json({ error: "Method not allowed." }, { status: 405 }); }
