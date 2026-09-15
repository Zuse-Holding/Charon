import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { checkRateLimit, clientIp } from "../../../../lib/rate-limit";
import { trackEvent } from "../../../../lib/analytics";

// Task 3.1 — account-farming resistance. Deliberately the tightest of the
// three auth limits (signup creates a new, permanent resource; sign-in and
// reset don't).
const MAX_PER_HOUR = Number(process.env.RATE_LIMIT_SIGNUP_PER_HOUR ?? 10);
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Proxies signup server-side (task 3.1) so it can be rate-limited by IP —
 * the browser previously called supabase.auth.signUp() directly, which our
 * server never saw. Returns whether a session came back (Supabase's own
 * signal for "email confirmation wasn't required," used by the login page
 * to decide whether to route straight in or show "check your email").
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const { allowed, resetInMs } = checkRateLimit(`signup:${ip}`, MAX_PER_HOUR, WINDOW_MS);
  if (!allowed) {
    return NextResponse.json(
      { error: `Too many signup attempts. Try again in ${Math.ceil(resetInMs / 60000)} minutes.` },
      { status: 429 }
    );
  }

  const { email, password, firstName, lastName } = await req.json().catch(() => ({}));
  if (!email || !password || !firstName?.trim() || !lastName?.trim()) {
    return NextResponse.json({ error: "Email, password, first name, and last name are required." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient({ rememberMe: true });
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName.trim(), last_name: lastName.trim(), full_name: fullName },
    },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (data.user) trackEvent(data.user.id, "signup");
  return NextResponse.json({ hasSession: !!data.session });
}
