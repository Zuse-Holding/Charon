import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../../lib/supabase/server";

/**
 * Confirm or reject a possible match. kg_decide_match (supabase/schema.sql)
 * applies it atomically as the signed-in user and logs who and when.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "confirmed" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be confirmed or rejected" }, { status: 400 });
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("kg_decide_match", { p_review_id: id, p_decision: decision });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}
