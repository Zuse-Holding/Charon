import { NextRequest, NextResponse } from "next/server";
import { callAgent, sessionUserId } from "../../../lib/exclusions";

/** The signed-in user's self-exclusion entries (masked) and their limit. */
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return callAgent(`/exclusions/${encodeURIComponent(userId)}`, { method: "GET" });
}

/** Adds an entry; it takes effect once ownership is confirmed. */
export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const { kind, value, attest } = body ?? {};
  return callAgent("/exclusions/add", { method: "POST", body: { userId, kind, value, attest } });
}
