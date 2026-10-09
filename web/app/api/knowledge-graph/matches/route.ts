import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { loadPendingMatches } from "../../../../lib/kg-matches";

/** Possible matches awaiting the signed-in user's decision (Feature 3),
 *  each tagged with the report re-run that produced it, if any. */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    return NextResponse.json(await loadPendingMatches(supabase));
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
