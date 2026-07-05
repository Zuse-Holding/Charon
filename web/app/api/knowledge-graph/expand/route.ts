import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

/**
 * Click-to-expand: given an entity name that exists in the graph but was
 * never directly researched, trigger a lightweight background research
 * pass to pull in its own connections. Runs the same research pipeline
 * as a normal search, then relies on the existing entity-extraction
 * pass to populate new relationships.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { entityName, entityType } = await req.json();
    if (!entityName) return NextResponse.json({ error: "entityName required" }, { status: 400 });

    // Map entity type to research type — default to company for anything unclear
    const researchType = entityType === "person" ? "person" : entityType === "product" ? "product" : "company";

    const agentUrl = process.env.AGENT_SERVER_URL;
    if (!agentUrl) return NextResponse.json({ error: "Agent server not configured" }, { status: 500 });

    // Fire the same research pipeline used for normal searches —
    // this will also trigger entity-extraction automatically afterward
    const res = await fetch(`${agentUrl}/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET ?? "",
      },
      body: JSON.stringify({ subject: entityName, type: researchType, userId: user.id }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `Research failed: ${errText.slice(0, 200)}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, message: `Researching ${entityName}... check back in ~30 seconds.` });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
