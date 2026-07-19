import { NextResponse } from "next/server";
import { getPendingRunForUser } from "../../../../lib/supabase/data";

export async function GET() {
  try {
    const run = await getPendingRunForUser();
    return NextResponse.json(run);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
