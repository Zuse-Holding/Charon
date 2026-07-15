import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

/**
 * Admin-only quarterly refresh trigger for statewide_executives. Not a
 * dashboard feature — intended for an admin to call directly (curl/
 * Postman) with reviewed officeholder data after a manual Ballotpedia
 * check. See server/agent-server.ts POST /admin/statewide-executives/refresh.
 */
export async function POST(req: NextRequest) {
  const { updates } = await req.json();
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const res = await fetch(`${AGENT_URL}/admin/statewide-executives/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
      },
      body: JSON.stringify({ userId: user.id, updates }),
    });

    if (res.status === 403) {
      return NextResponse.json({ error: "Statewide-executives refresh requires Charon tier" }, { status: 403 });
    }
    const data = await res.json();
    if (!res.ok) throw new Error("Agent statewide-executives refresh failed");

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/admin/statewide-executives] failed:", err);
    return NextResponse.json({ error: "Failed to refresh statewide executives" }, { status: 500 });
  }
}
