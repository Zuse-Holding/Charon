import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getAgentSecret } from "../../../../lib/agent-secret";

const AGENT_URL = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";

/** Log acquisition spend for CAC. Validation and the tier check live on the agent server. */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const res = await fetch(`${AGENT_URL}/admin/acquisition-spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": getAgentSecret() },
      body: JSON.stringify({
        userId: user.id,
        spentOn: body.spentOn,
        amountUsd: body.amountUsd,
        channel: body.channel,
        note: body.note,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[api/admin/acquisition-spend] failed:", err);
    return NextResponse.json({ error: "Failed to log spend" }, { status: 500 });
  }
}
