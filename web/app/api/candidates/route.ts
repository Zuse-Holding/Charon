import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { getAgentSecret } from "../../../lib/agent-secret";

/**
 * Candidate step (Fix 1, Fix 5): the businesses or people sharing a name,
 * from the agent server. Without an agent server (local dev) it answers
 * ok: false and the search bar runs the report directly, as before.
 */
export async function POST(req: NextRequest) {
  const { subject, type } = await req.json();
  if (typeof subject !== "string" || !subject.trim() || (type !== "company" && type !== "person")) {
    return NextResponse.json({ error: "subject and type (company or person) required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const agentUrl = process.env.AGENT_SERVER_URL;
  if (!agentUrl) return NextResponse.json({ ok: false, candidates: [] });

  const sanitized = subject.trim().slice(0, 200).replace(/[\x00-\x1f]/g, "");
  const res = await fetch(`${agentUrl}/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
    body: JSON.stringify({ subject: sanitized, type, userId: user.id }),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
