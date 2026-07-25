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
      cache: "no-store",
    });

    if (!res.ok) throw new Error("Agent tier fetch failed");

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
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
        charonProtocol: false,
        personResearchAccess: false,
        muckrockAccess: false,
        adminAccess: false,
        monthlyResearchLimit: 25,
        publicRecordsAccess: false,
        creatorAccess: false,
      },
      displayName: null,
      monthlyUsage: null,
    });
  }
}