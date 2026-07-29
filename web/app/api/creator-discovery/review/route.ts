import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "../../../../lib/supabase/server";

// See ../route.ts's safeJson for why this exists — an agent-server error
// page (stale deploy, proxy failure) isn't JSON, and calling res.json()
// directly on it throws a raw parse error with no useful message.
async function safeJson(res: Response): Promise<{ status: number; data: unknown }> {
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return {
      status: res.status,
      data: { error: `Agent server returned a non-JSON response (HTTP ${res.status}). It may need to be redeployed with the latest code. First 200 chars: ${text.slice(0, 200)}` },
    };
  }
}

/**
 * Promote/reject a single discovery candidate. Dev-fallback branch below
 * duplicates promoteCandidate/rejectCandidate's logic from
 * src/agents/creator-discovery-agent inline rather than importing it —
 * see the doc comment on GET in ../route.ts for why (Next's webpack
 * bundler won't resolve a path outside web/'s own directory, even though
 * tsconfig's @src/* alias satisfies tsc itself). Production always goes
 * through agent-server.ts instead, which imports the real functions directly.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { candidateId, action, reason } = await req.json();
  if (!candidateId || (action !== "promote" && action !== "reject")) {
    return NextResponse.json({ error: "candidateId and action ('promote'|'reject') required" }, { status: 400 });
  }

  const agentUrl = process.env.AGENT_SERVER_URL;
  if (agentUrl) {
    const res = await fetch(`${agentUrl}/creator-discovery/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": process.env.AGENT_SECRET ?? "" },
      body: JSON.stringify({ userId: user.id, candidateId, action, reason }),
    });
    const { status, data } = await safeJson(res);
    return NextResponse.json(data, { status });
  }

  const supabaseAdmin = createServiceClient();

  if (action === "reject") {
    const { error } = await supabaseAdmin
      .from("creator_discovery_candidates")
      .update({ status: "rejected", notes: reason ?? "Rejected by reviewer — no reason given", reviewed_at: new Date().toISOString() })
      .eq("id", candidateId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data: candidate, error: fetchError } = await supabaseAdmin
    .from("creator_discovery_candidates")
    .select("*")
    .eq("id", candidateId)
    .single();
  if (fetchError || !candidate) return NextResponse.json({ error: `Candidate ${candidateId} not found` }, { status: 404 });
  if (candidate.status === "promoted" && candidate.watchlist_id) {
    return NextResponse.json({ ok: true, watchlistId: candidate.watchlist_id });
  }

  const watchlistId = `watch-${Date.now()}`;
  const { error: insertError } = await supabaseAdmin.from("watchlist").insert({
    id: watchlistId,
    user_id: user.id,
    type: "creator",
    subject: candidate.raw_candidate,
    added_at: new Date().toISOString(),
  });
  if (insertError) return NextResponse.json({ error: `Failed to create watchlist row: ${insertError.message}` }, { status: 500 });

  const { error: updateError } = await supabaseAdmin
    .from("creator_discovery_candidates")
    .update({ status: "promoted", watchlist_id: watchlistId, reviewed_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (updateError) return NextResponse.json({ error: `Failed to mark candidate promoted: ${updateError.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, watchlistId });
}
