import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { checkRateLimit, clientIp } from "../../../../lib/rate-limit";
import { trackEvent } from "../../../../lib/analytics";
import { getAgentSecret } from "../../../../lib/agent-secret";

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
  if (data.user) {
    trackEvent(data.user.id, "signup");
    sendWelcomeEmail(email, firstName).catch((err) => console.error("[signup] welcome email failed:", err));
  }
  return NextResponse.json({ hasSession: !!data.session });
}

// Best-effort, fire-and-forget — a welcome email failing should never fail
// or delay signup itself. Proxied through the agent server (task 4.2)
// rather than calling Resend directly from here, so the actual send logic
// and copy stay in one place (src/lib/email) alongside the day-7 and
// cap-reached emails, which already have to live server-side.
async function sendWelcomeEmail(email: string, firstName: string) {
  const agentUrl = process.env.AGENT_SERVER_URL;
  if (!agentUrl) return;
  await fetch(`${agentUrl}/email/welcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
    body: JSON.stringify({ email, firstName }),
  });
}
