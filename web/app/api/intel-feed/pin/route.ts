import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ pinned: [] });

    const { data } = await supabase
      .from("pinned_feed_items")
      .select("item_key")
      .eq("user_id", user.id);

    return NextResponse.json({ pinned: (data ?? []).map(d => d.item_key) });
  } catch {
    return NextResponse.json({ pinned: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { itemKey, headline, sector, url } = await req.json();
    if (!itemKey) return NextResponse.json({ error: "itemKey required" }, { status: 400 });

    const { error } = await supabase.from("pinned_feed_items").upsert({
      user_id: user.id,
      item_key: itemKey,
      headline: headline ?? null,
      sector: sector ?? null,
      url: url ?? null,
      pinned_at: new Date().toISOString(),
    }, { onConflict: "user_id,item_key" });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { itemKey } = await req.json();
    if (!itemKey) return NextResponse.json({ error: "itemKey required" }, { status: 400 });

    const { error } = await supabase
      .from("pinned_feed_items")
      .delete()
      .eq("user_id", user.id)
      .eq("item_key", itemKey);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}