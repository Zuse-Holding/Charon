import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "../../../../lib/supabase/server";
import { getStripe, planForPriceId } from "../../../../lib/stripe";

/**
 * Single source of truth that keeps profiles.tier honest. Every tier-gated
 * route in server/agent-server.ts reads profiles.tier via getUserTier() —
 * this webhook is the only thing that should ever write it for a paying
 * account. See docs/stripe-integration-plan.md.
 *
 * Deliberately never writes "trial" or "internal" — those are assigned by
 * hand for demo/partner and Charon accounts and have nothing to do with
 * Stripe. A subscription event for an account sitting in either of those
 * states should not silently downgrade or reclassify it.
 */
const PROTECTED_TIERS = new Set(["trial", "internal"]);

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const service = createServiceClient();

  try {
    switch (event.type) {
      // First payment succeeds — attach the Stripe customer to the
      // Supabase user and set their tier for the first time.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.supabase_user_id;
        if (!userId) {
          console.error("[stripe/webhook] checkout.session.completed with no user id", session.id);
          break;
        }
        if (await hasProtectedTier(service, userId)) break;

        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        const priceId = subscriptionId ? await getFirstPriceId(subscriptionId) : null;
        const plan = priceId ? planForPriceId(priceId) : null;

        await writeSubscriptionState(service, userId, {
          stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
          stripe_subscription_id: subscriptionId ?? null,
          stripe_price_id: priceId,
          subscription_status: "active",
          tier: plan,
        });
        break;
      }

      // Renewals, plan changes, cancellations-at-period-end, and failed
      // payments (status flips to past_due) all land here.
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdByCustomer(service, sub.customer);
        if (!userId) break;

        const priceId = sub.items.data[0]?.price.id ?? null;
        const plan = priceId ? planForPriceId(priceId) : null;

        await writeSubscriptionState(service, userId, {
          stripe_subscription_id: sub.id,
          stripe_price_id: priceId,
          subscription_status: sub.status,
          current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
          // Only demote/promote tier on a status that actually reflects
          // paid access — a transient "incomplete" during retries
          // shouldn't yank access on its own.
          tier: sub.status === "active" || sub.status === "trialing" ? plan : undefined,
        });
        break;
      }

      // Subscription fully ends (period elapsed after cancellation, or
      // Stripe gave up on a failed payment). Downgrade to basic — never
      // to "free", which is a different, more restricted tier that
      // nothing in the pricing page maps to.
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdByCustomer(service, sub.customer);
        if (!userId) break;

        await writeSubscriptionState(service, userId, {
          subscription_status: "canceled",
          tier: "basic",
        });
        break;
      }

      default:
        // Unhandled event types are expected — Stripe sends many more
        // than we act on. Not an error.
        break;
    }
  } catch (err) {
    console.error(`[stripe/webhook] failed handling ${event.type}:`, err);
    // Still 200 — a 4xx/5xx here makes Stripe retry, which won't fix a
    // bug in our handler and just delays visibility into it.
  }

  return NextResponse.json({ received: true });
}

async function getFirstPriceId(subscriptionId: string): Promise<string | null> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  return sub.items.data[0]?.price.id ?? null;
}

async function resolveUserIdByCustomer(
  service: ReturnType<typeof createServiceClient>,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
): Promise<string | null> {
  const customerId = typeof customer === "string" ? customer : customer.id;
  const { data, error } = await service
    .from("profiles")
    .select("id, tier")
    .eq("stripe_customer_id", customerId)
    .single();

  if (error || !data) {
    console.error("[stripe/webhook] no profile found for stripe_customer_id", customerId);
    return null;
  }
  if (PROTECTED_TIERS.has(data.tier)) {
    console.warn(`[stripe/webhook] skipping tier write for protected-tier account`, data.id, data.tier);
    return null;
  }
  return data.id;
}

async function hasProtectedTier(service: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data } = await service.from("profiles").select("tier").eq("id", userId).single();
  if (data && PROTECTED_TIERS.has(data.tier)) {
    console.warn("[stripe/webhook] skipping write for protected-tier account", userId, data.tier);
    return true;
  }
  return false;
}

interface SubscriptionState {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  subscription_status?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  tier?: string | null;
}

async function writeSubscriptionState(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  state: SubscriptionState
) {
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value !== undefined) update[key] = value;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await service.from("profiles").update(update).eq("id", userId);
  if (error) {
    console.error("[stripe/webhook] profiles update failed:", error, { userId, update });
  }
}
