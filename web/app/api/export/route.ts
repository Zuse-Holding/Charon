import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

/**
 * Proxies a data-export request to the agent server, which holds the
 * service-role Supabase key and enforces the exportAccess tier gate.
 * Same pattern as /api/tier and /api/profile: the browser never sees
 * AGENT_SECRET, and the export is scoped to the authenticated user's
 * own id from their session cookie.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/export/${user.id}`, {
      headers: { "x-agent-secret": AGENT_SECRET },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? "Export failed" }, { status: res.status });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
