import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "../../../../lib/supabase/server";
import { getStripe } from "../../../../lib/stripe";

/**
 * Creates a Stripe Billing Portal session so a user can update payment
 * method, view invoices, or cancel — self-serve, no support email needed.
 * This is what makes the pricing FAQ's "cancel anytime" answer literally
 * true instead of aspirational copy.
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const service = createServiceClient();
    const { data: profile } = await service
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No billing account on file yet — subscribe to a plan first" }, { status: 400 });
    }

    const siteUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl}/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/portal]", err);
    const message = err instanceof Error ? err.message : "Could not open billing portal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
