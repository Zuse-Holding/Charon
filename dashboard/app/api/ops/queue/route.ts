import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Approve / reject / undo for the approval queue. Server-side on purpose:
// an approved row really gets executed now (agents/executor.py), so this
// write sits behind the dashboard login (middleware.ts) instead of being
// open to the browser's anon key. schema.sql has no anon update policy on
// approval_queue anymore.
//
// Every transition is a conditional update — it only lands if the row is
// still in the state the button assumed. Undo after the executor has
// claimed a row (status 'executing' or later) fails, and the UI says so.

export const dynamic = "force-dynamic";

const TRANSITIONS = {
  approve: { from: ["pending"], to: "approved" },
  reject: { from: ["pending"], to: "rejected" },
  undo: { from: ["approved", "rejected"], to: "pending" },
} as const;

type Action = keyof typeof TRANSITIONS;

export async function POST(req: NextRequest) {
  let body: { id?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { id, action } = body;
  if (typeof id !== "string" || typeof action !== "string" || !(action in TRANSITIONS)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const t = TRANSITIONS[action as Action];
  const { data, error } = await createServiceClient()
    .from("approval_queue")
    .update({ status: t.to, resolved_at: t.to === "pending" ? null : new Date().toISOString() })
    .eq("id", id)
    .in("status", [...t.from])
    .select("*");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    const msg = action === "undo" ? "Too late to undo. It's already gone out." : "Someone already handled this one.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
  return NextResponse.json({ row: data[0] });
}
