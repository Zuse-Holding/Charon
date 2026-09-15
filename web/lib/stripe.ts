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

export type PlanKey = "basic" | "pro" | "team";

/**
 * Maps our plan names to Stripe Price IDs via env vars, not a hardcoded
 * table — Price IDs differ between test mode and live mode, so this reads
 * whatever's currently configured rather than baking in one environment's
 * ids.
 */
export function priceIdForPlan(plan: PlanKey): string {
  const map: Record<PlanKey, string | undefined> = {
    basic: process.env.STRIPE_PRICE_ID_BASIC,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    team: process.env.STRIPE_PRICE_ID_TEAM,
  };

  const priceId = map[plan];
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan "${plan}" — set STRIPE_PRICE_ID_${plan.toUpperCase()}`);
  }
  return priceId;
}

export function planForPriceId(priceId: string): PlanKey | null {
  if (priceId === process.env.STRIPE_PRICE_ID_BASIC) return "basic";
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ID_TEAM) return "team";
  return null;
}
