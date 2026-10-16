// Single-user dashboard session (spec §7: "single user: Nick"). A signed,
// expiring cookie — no user table, no third-party auth. Web Crypto only, so
// the same code runs in middleware (edge) and route handlers (node).
//
// Env (server-only, Vercel + .env.local):
//   DASHBOARD_PASSWORD        the password the login page checks
//   DASHBOARD_SESSION_SECRET  optional; signs the cookie. Defaults to the
//                             password, so changing it logs every device out.

export const SESSION_COOKIE = "selene_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function secret(): string | null {
  return process.env.DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_PASSWORD || null;
}

export function authConfigured(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time for equal-length strings; length itself isn't secret here
// (both sides are fixed-length hex digests).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionValue(): Promise<string> {
  const key = secret();
  if (!key) throw new Error("DASHBOARD_PASSWORD is not set");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  return `${expires}.${await hmac(key, `session:${expires}`)}`;
}

export async function verifySessionValue(value: string | undefined): Promise<boolean> {
  const key = secret();
  if (!key || !value) return false;
  const [expires, sig] = value.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await hmac(key, `session:${expires}`));
}

export async function passwordMatches(attempt: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  // Compare digests so the comparison is fixed-length regardless of input.
  return safeEqual(await hmac("pw", attempt), await hmac("pw", expected));
}
