import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "../../../../lib/supabase/server";
import { getStripe, priceIdForPlan, type PlanKey } from "../../../../lib/stripe";

const PLAN_KEYS: PlanKey[] = ["basic", "pro", "team"];

/**
 * Creates a Stripe Checkout Session for the logged-in user and returns the
 * redirect URL. Enterprise isn't here — it's mailto/custom, not self-serve.
 *
 * If the user already has a Stripe customer (profiles.stripe_customer_id),
 * reuse it so their payment history and any existing subscription stay
 * attached to one customer instead of fragmenting across signups.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const plan = body.plan as string | undefined;

    if (!plan || !PLAN_KEYS.includes(plan as PlanKey)) {
      return NextResponse.json({ error: `plan must be one of: ${PLAN_KEYS.join(", ")}` }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stripe = getStripe();
    const priceId = priceIdForPlan(plan as PlanKey);

    const service = createServiceClient();
    const { data: profile } = await service
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    const siteUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: profile?.stripe_customer_id || undefined,
      customer_email: profile?.stripe_customer_id ? undefined : user.email,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/settings?checkout=success`,
      cancel_url: `${siteUrl}/pricing?checkout=cancelled`,
      // Lets the webhook resolve a brand-new customer back to this
      // Supabase user on checkout.session.completed, before
      // stripe_customer_id has been persisted anywhere.
      metadata: { supabase_user_id: user.id, plan },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
