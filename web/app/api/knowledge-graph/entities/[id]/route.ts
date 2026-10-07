import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../../lib/supabase/server";

/** An entity's identifiers and how it relates to same-named entities
 *  (Feature 3). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // interpolated into the .or() filter below, so only a UUID gets through
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const supabase = await createServerSupabaseClient();
    const [ids, reviews] = await Promise.all([
      supabase.from("kg_entity_identifiers")
        .select("kind, issuer, value, source_name, source_url, retrieved_at")
        .eq("entity_id", id),
      supabase.from("kg_match_reviews")
        .select("id, entity_id, entity_name, candidate_id, candidate_name, status, reason, decided_at")
        .or(`entity_id.eq.${id},candidate_id.eq.${id}`)
        .in("status", ["pending", "distinct", "rejected"]),
    ]);
    if (ids.error) throw ids.error;
    if (reviews.error) throw reviews.error;
    return NextResponse.json({ identifiers: ids.data ?? [], reviews: reviews.data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("kg_entities")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
