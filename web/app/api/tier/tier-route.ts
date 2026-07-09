import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

const AGENT_URL    = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_SECRET = process.env.AGENT_SECRET ?? "change-me-in-production";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await fetch(`${AGENT_URL}/tier/${user.id}`, {
      headers: { "x-agent-secret": AGENT_SECRET },
      next: { revalidate: 60 }, // cache for 60s — tier doesn't change often
    });

    if (!res.ok) throw new Error("Agent tier fetch failed");

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    // Fail open to basic — never block the user entirely
    return NextResponse.json({
      tier: "basic",
      config: {
        dailyResearchLimit: 10,
        dailyDeepDiveLimit: 0,
        deepDiveAccess: false,
        politicalAccess: false,
        watchlistLimit: 5,
        knowledgeGraphAccess: false,
        exportAccess: false,
        jackalProtocol: false,
      },
    });
  }
}
