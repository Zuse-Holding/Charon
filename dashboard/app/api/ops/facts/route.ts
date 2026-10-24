import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Memory tab writes: add a fact Nick wants Selene to know, or switch one
// off when it's wrong or stale. Service role behind the dashboard login —
// the anon key can only read selene_facts (schema.sql). Facts are never
// hard-deleted; inactive ones just stop reaching Selene's prompts.

export const dynamic = "force-dynamic";

const MAX_FACT = 500;

export async function POST(req: NextRequest) {
  let body: { action?: unknown; fact?: unknown; id?: unknown; active?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const db = createServiceClient();

  if (body.action === "add") {
    const fact = typeof body.fact === "string" ? body.fact.trim() : "";
    if (!fact || fact.length > MAX_FACT) {
      return NextResponse.json({ error: `Keep it to one fact, under ${MAX_FACT} characters.` }, { status: 400 });
    }
    const { data, error } = await db.from("selene_facts").insert({ fact, source: "nick" }).select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data?.[0] });
  }

  if (body.action === "set_active" && typeof body.id === "string" && typeof body.active === "boolean") {
    const { data, error } = await db.from("selene_facts").update({ active: body.active }).eq("id", body.id).select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "That fact's gone." }, { status: 404 });
    return NextResponse.json({ row: data[0] });
  }

  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
