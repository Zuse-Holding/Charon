import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

/**
 * Pin/unpin an Intel Feed item. Pinned items are stored per-user so they
 * persist across sessions and float to the top of the feed.
 */
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
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

/**
 * Pin/unpin an Intel Feed item. Pinned items are stored per-user so they
 * persist across sessions and float to the top of the feed.
 */
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
const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
useEffect(() => {
  fetch("/api/intel-feed/pin")
    .then(r => r.json())
    .then(d => setPinnedKeys(new Set(d.pinned ?? [])))
    .catch(() => {});
}, []);
async function togglePin(item: FeedItem, sectorId: string) {
  const key = `${sectorId}:${item.headline}`;
  const isPinned = pinnedKeys.has(key);

  if (isPinned) {
    await fetch("/api/intel-feed/pin", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemKey: key }),
    });
    setPinnedKeys(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  } else {
    await fetch("/api/intel-feed/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemKey: key,
        headline: item.headline,
        sector: sectorId,
        url: item.url,
      }),
    });
    setPinnedKeys(prev => new Set(prev).add(key));
  }
}
<div key={i} className={styles.item}>
  <div className={styles.itemTop}>
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.itemHeadline}>
      {item.headline}
    </a>
    <button
      className={`${styles.pinBtn} ${pinnedKeys.has(`${sector.id}:${item.headline}`) ? styles.pinned : ""}`}
      onClick={() => togglePin(item, sector.id)}
      title={pinnedKeys.has(`${sector.id}:${item.headline}`) ? "Unpin" : "Pin to top"}
    >
      {pinnedKeys.has(`${sector.id}:${item.headline}`) ? "★" : "☆"}
    </button>
  </div>
