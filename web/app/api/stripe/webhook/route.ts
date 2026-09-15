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

  // Idempotency: claim this event id before doing any work. A duplicate
  // delivery (Stripe retries routinely — a slow 200, a flaky network) hits
  // the primary-key conflict on stripe_webhook_events and is skipped
  // rather than reprocessed. Claiming via insert-first (not check-then-act)
  // avoids a race between two near-simultaneous deliveries of the same event.
  const { error: claimError } = await service
    .from("stripe_webhook_events")
    .insert({ id: event.id, type: event.type });

  if (claimError) {
    if (claimError.code === "23505") {
      // Unique-violation — already processed (or a concurrent request is
      // processing it right now). Either way, don't do it again.
      return NextResponse.json({ received: true, deduped: true });
    }
    // Any other DB error: log and process anyway rather than silently
    // dropping a real event because the ledger write itself failed
    // (e.g. the migration in supabase/schema.sql hasn't been run yet).
    console.error("[stripe/webhook] idempotency claim failed, processing anyway:", claimError);
  }

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

        // past_due: leave tier untouched — access continues while Stripe's
        // Smart Retries work through it (web/app/layout.tsx's banner is
        // what surfaces this to the user, not an access change here).
        // canceled/unpaid: enforce the downgrade immediately rather than
        // waiting for the separate subscription.deleted event, per task 1.4.
        // Any other transient status (incomplete, incomplete_expired):
        // leave tier untouched — an in-progress first payment shouldn't
        // yank access that was never granted in the first place.
        let tier: string | undefined;
        if (sub.status === "active" || sub.status === "trialing") tier = plan ?? undefined;
        else if (sub.status === "canceled" || sub.status === "unpaid") tier = "free";

        await writeSubscriptionState(service, userId, {
          stripe_subscription_id: sub.id,
          stripe_price_id: priceId,
          subscription_status: sub.status,
          current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
          tier,
        });
        break;
      }

      // Subscription fully ends (period elapsed after cancellation, or
      // Stripe gave up on a failed payment after unpaid). Downgrade to
      // free — matches the canceled/unpaid handling in subscription.updated
      // above; this event is the guaranteed final confirmation in case that
      // one was somehow missed.
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserIdByCustomer(service, sub.customer);
        if (!userId) break;

        await writeSubscriptionState(service, userId, {
          subscription_status: "canceled",
          tier: "free",
        });
        break;
      }

      // Renewal or recovery payment succeeded. Mostly a defensive re-sync
      // (customer.subscription.updated already flips status back to
      // "active" on recovery) — cheap insurance against acting on stale
      // subscription_status if these two events ever arrive out of order.
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.customer) break;
        const userId = await resolveUserIdByCustomer(service, invoice.customer);
        if (!userId) break;

        await writeSubscriptionState(service, userId, { subscription_status: "active" });
        break;
      }

      // A charge failed. Deliberately no state write here — the
      // accompanying customer.subscription.updated event (status flips to
      // past_due) is what actually drives the banner and any eventual
      // downgrade; writing subscription_status from both events risks one
      // overwriting the other with stale data if they arrive out of order.
      // Handled explicitly (not falling through to default) so it's clear
      // this is a deliberate no-op, not a gap.
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn("[stripe/webhook] payment failed for invoice", invoice.id, "customer", invoice.customer);
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
