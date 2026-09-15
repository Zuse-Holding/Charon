import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { checkRateLimit, clientIp } from "../../../../lib/rate-limit";

// Task 3.1 — email-bombing resistance (repeated reset-link sends). The
// tightest of the three: unlike signin/signup, every request here sends a
// real email regardless of whether it succeeds or fails quietly.
const MAX_PER_HOUR = Number(process.env.RATE_LIMIT_RESET_PER_HOUR ?? 5);
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Proxies the "send reset link" action server-side (task 3.1) — same
 * reasoning as /api/auth/signup. Supabase's resetPasswordForEmail already
 * doesn't reveal whether the address has an account (always looks like
 * success from the caller's side) — this route doesn't change that.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const { allowed, resetInMs } = checkRateLimit(`reset:${ip}`, MAX_PER_HOUR, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: `Too many reset requests. Try again in ${Math.ceil(resetInMs / 60000)} minutes.` },
      { status: 429 }
    );
  }

  const { email } = await req.json().catch(() => ({}));
  if (!email) return NextResponse.json({ error: "Email required." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${req.nextUrl.origin}/login`,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
