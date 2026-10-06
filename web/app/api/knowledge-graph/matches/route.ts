import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

/** Possible matches awaiting the signed-in user's decision (Feature 3). */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("kg_match_reviews")
      .select("id, entity_id, entity_name, candidate_id, candidate_name, reason, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
