import Stripe from "stripe";

/**
 * Lazy singleton — throws a clear error at call time (not import time) if
 * STRIPE_SECRET_KEY is unset, so routes that don't need Stripe never fail
 * to load, and routes that do fail loudly instead of silently no-op-ing.
 * See docs/stripe-integration-plan.md.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Stripe is not configured — set STRIPE_SECRET_KEY (see docs/stripe-integration-plan.md)"
    );
  }

  _stripe = new Stripe(key);
  return _stripe;
}

// Team is intentionally not sellable — TIER_CONFIG.team still exists
// server-side (server/agent-server.ts) for accounts assigned to it by hand,
// but Checkout only ever offers Basic and Pro. See docs/stripe-integration-plan.md.
export type PlanKey = "basic" | "pro";

/**
 * Maps our plan names to Stripe Price IDs via env vars, not a hardcoded
 * table — Price IDs differ between test mode and live mode, so this reads
 * whatever's currently configured rather than baking in one environment's
 * ids.
 */
export function priceIdForPlan(plan: PlanKey): string {
  const map: Record<PlanKey, string | undefined> = {
    basic: process.env.STRIPE_PRICE_BASIC_MONTHLY,
    pro: process.env.STRIPE_PRICE_PRO_MONTHLY,
  };

  const priceId = map[plan];
  if (!priceId) {
    const envVar = plan === "basic" ? "STRIPE_PRICE_BASIC_MONTHLY" : "STRIPE_PRICE_PRO_MONTHLY";
    throw new Error(`No Stripe price configured for plan "${plan}" — set ${envVar}`);
  }
  return priceId;
}

export function planForPriceId(priceId: string): PlanKey | null {
  if (priceId === process.env.STRIPE_PRICE_BASIC_MONTHLY) return "basic";
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return "pro";
  return null;
}
