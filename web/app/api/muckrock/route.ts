import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

export async function POST(req: NextRequest) {
  const { query } = await req.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const res = await fetch(`${AGENT_URL}/muckrock/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
      },
      body: JSON.stringify({ userId: user.id, query: query.trim().slice(0, 200) }),
    });

    const data = await res.json();
    if (res.status === 403) {
      return NextResponse.json({ error: "MuckRock FOIA Search requires Charon tier" }, { status: 403 });
    }
    if (!res.ok) throw new Error("Agent muckrock-search fetch failed");

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/muckrock] failed:", err);
    return NextResponse.json({ error: "Failed to run MuckRock search" }, { status: 500 });
  }
}
