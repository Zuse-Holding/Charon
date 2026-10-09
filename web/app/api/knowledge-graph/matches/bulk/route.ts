import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../../lib/supabase/server";
import { loadPendingMatches } from "../../../../../lib/kg-matches";

/**
 * "Merge all from this report": confirms every pending match that a
 * re-run of one report created against an earlier run of the same report.
 * Each merge goes through kg_decide_match, so every one is checked and
 * logged with who and when, exactly as if clicked one by one. Matches
 * from any other report are refused here, whatever the request says.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const runId: unknown = body?.runId;
  if (typeof runId !== "string" || !runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }
  const supabase = await createServerSupabaseClient();
  let pending;
  try {
    pending = await loadPendingMatches(supabase, 500);
  } catch {
    return NextResponse.json({ error: "Couldn't load the matches. Try again." }, { status: 500 });
  }
  const targets = pending.filter((m) => m.sameReportRun?.id === runId);
  if (targets.length === 0) return NextResponse.json({ merged: 0, skipped: 0, failed: [] });

  let merged = 0, skipped = 0;
  const failed: { name: string; error: string }[] = [];
  for (const m of targets) {
    const { error } = await supabase.rpc("kg_decide_match", { p_review_id: m.id, p_decision: "confirmed" });
    if (!error) merged++;
    // An earlier merge in this batch already folded or removed this one.
    else if (/already decided|not found|no longer exists/i.test(error.message)) skipped++;
    else failed.push({ name: m.entity_name, error: error.message });
  }
  return NextResponse.json({ merged, skipped, failed });
}
