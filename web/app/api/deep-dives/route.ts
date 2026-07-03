import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { randomUUID } from "node:crypto";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await req.json();
    const { company, sections, durationMs } = body;

    if (!company || !sections) {
      return NextResponse.json({ error: "company and sections required" }, { status: 400 });
    }

    const id = randomUUID();
    const { error } = await supabase.from("deep_dives").insert({
      id,
      user_id: user.id,
      company,
      generated_at: new Date().toISOString(),
      bundle: { company, sections, durationMs, generatedAt: new Date().toISOString() },
    });

    if (error) throw error;
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const company = req.nextUrl.searchParams.get("company");
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

    const { data, error } = await supabase
      .from("deep_dives")
      .select("id, company, generated_at, bundle")
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
