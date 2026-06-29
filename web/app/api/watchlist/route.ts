import { NextRequest, NextResponse } from "next/server";
import {
  getWatchlistForUser,
  addToWatchlistForUser,
  removeFromWatchlistForUser,
  updateWatchlistRefreshForUser,
} from "../../../lib/supabase/data";

export async function GET() {
  try {
    const watchlist = await getWatchlistForUser();
    return NextResponse.json(watchlist);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { subject, type, refreshIntervalDays } = await req.json();
    if (!subject || !type) return NextResponse.json({ error: "subject and type required" }, { status: 400 });
    const entry = await addToWatchlistForUser(subject, type, refreshIntervalDays ?? 3);
    return NextResponse.json(entry);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await removeFromWatchlistForUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await updateWatchlistRefreshForUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
