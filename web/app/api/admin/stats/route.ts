import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/admin/stats/${user.id}`, {
      headers: { "x-agent-secret": AGENT_SECRET },
      cache: "no-store",
    });

    if (res.status === 403) {
      return NextResponse.json({ error: "Admin stats require Charon tier" }, { status: 403 });
    }
    if (!res.ok) throw new Error("Agent admin-stats fetch failed");

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/admin/stats] failed:", err);
    return NextResponse.json({ error: "Failed to load admin stats" }, { status: 500 });
  }
}
