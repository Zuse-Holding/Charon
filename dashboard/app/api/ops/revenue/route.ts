import { NextResponse } from "next/server";
import { fetchRevenue } from "@/lib/stripe";

// Metis revenue, read-only from Stripe (lib/stripe.ts). Same "not
// connected" shape as /api/ops/alpaca so the UI can say what's missing.

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.STRIPE_RESTRICTED_KEY;
  if (!key) {
    return NextResponse.json({ connected: false, error: "No Stripe key yet." });
  }
  if (key.startsWith("sk_")) {
    // A full secret key can move money. Refuse it rather than quietly use it.
    return NextResponse.json({
      connected: false,
      error: "That's a full secret key. Use a restricted read-only key (rk_…) instead.",
    });
  }
  try {
    return NextResponse.json({ connected: true, ...(await fetchRevenue(key)) });
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : "Stripe sync failed." });
  }
}
