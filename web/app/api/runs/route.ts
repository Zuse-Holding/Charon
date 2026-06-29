import { NextRequest, NextResponse } from "next/server";
import { getAllRunsForUser, deleteRunForUser } from "../../../lib/supabase/data";

export async function GET() {
  try {
    const runs = await getAllRunsForUser();
    return NextResponse.json(runs);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteRunForUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
