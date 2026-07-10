import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

/**
 * Proxies a display-name update to the agent server, which holds the
 * service-role Supabase key. Mirrors the /api/tier route's pattern:
 * the browser never sees AGENT_SECRET, and the write is scoped to the
 * authenticated user's own id from their session cookie (not anything
 * the client sends), so there's no way to edit someone else's profile.
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const displayName = typeof body.displayName === "string" ? body.displayName : null;

    const res = await fetch(`${AGENT_URL}/profile/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
      },
      body: JSON.stringify({ displayName }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? "Update failed" }, { status: res.status });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
