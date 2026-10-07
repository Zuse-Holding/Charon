import { NextRequest, NextResponse } from "next/server";
import { callAgent, sessionUserId } from "../../../../lib/exclusions";

/** Removes an entry. Immediate. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  return callAgent("/exclusions/remove", { method: "POST", body: { userId, entryId: id } });
}

/** Confirms a phone entry with the SMS code. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  return callAgent("/exclusions/verify-code", { method: "POST", body: { userId, entryId: id, phone: body?.phone, code: body?.code } });
}
