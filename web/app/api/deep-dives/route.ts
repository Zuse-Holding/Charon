import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const company = req.nextUrl.searchParams.get("company");
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

    const { data, error } = await supabase
      .from("deep_dives")
      .select("id, company, generated_at, duration_ms, sections")
      .eq("user_id", user.id)
      .ilike("company", company)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return NextResponse.json(null);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(null);
  }
}
