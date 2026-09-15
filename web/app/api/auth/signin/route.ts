import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { checkRateLimit, clientIp } from "../../../../lib/rate-limit";

// Task 3.1 — credential-stuffing/brute-force resistance. Looser than
// signup's limit since legitimate users retry a mistyped password.
const MAX_PER_HOUR = Number(process.env.RATE_LIMIT_SIGNIN_PER_HOUR ?? 20);
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Proxies sign-in server-side (task 3.1) — same reasoning as
 * /api/auth/signup. rememberMe controls the session cookie's Max-Age,
 * same behavior as the browser client previously provided directly.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const { allowed, resetInMs } = checkRateLimit(`signin:${ip}`, MAX_PER_HOUR, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: `Too many sign-in attempts. Try again in ${Math.ceil(resetInMs / 60000)} minutes.` },
      { status: 429 }
    );
  }

  const { email, password, rememberMe } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient({ rememberMe: rememberMe !== false });
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
