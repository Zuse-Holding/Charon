/**
 * Stripe ↔ profiles reconciliation (red team S4). The webhook is the only
 * thing that writes a paying account's tier; this checks it didn't miss
 * one. For every Stripe customer it works out the tier the webhook should
 * have written and compares it with profiles.tier, and it lists paid-tier
 * accounts with no live subscription behind them.
 *
 * Dry run by default: reports mismatches and changes nothing. --apply
 * writes the same fields the webhook writes, for mismatches it can tie to
 * an account. Paid tiers with no subscription are only reported (they may
 * be hand-granted). Exits 1 when anything is out of sync, so it can run on
 * a schedule and alert.
 *   cd web && npx tsx --env-file=../.env scripts/reconcile-stripe.ts
 *   cd web && npx tsx --env-file=../.env scripts/reconcile-stripe.ts --apply
 *
 * Needs STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC_MONTHLY, STRIPE_PRICE_PRO_MONTHLY,
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripe, planForPriceId } from "../lib/stripe";

const APPLY = process.argv.includes("--apply");
// Matches the webhook: these keep the paid tier (past_due while Stripe
// retries), canceled/unpaid drop to free, anything else is left alone.
const LIVE = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);
const ENDED = new Set<Stripe.Subscription.Status>(["canceled", "unpaid"]);
// Assigned by hand, never by Stripe (see the webhook's PROTECTED_TIERS).
const PROTECTED = new Set(["trial", "internal"]);

interface Profile {
  id: string;
  tier: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  pro_grace_expires_at: string | null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const stripe = getStripe();

  const profiles: Profile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, tier, stripe_customer_id, stripe_subscription_id, pro_grace_expires_at")
      .or("stripe_customer_id.not.is.null,tier.in.(basic,pro)")
      .range(from, from + 999);
    if (error) throw error;
    profiles.push(...(data as Profile[]));
    if (!data || data.length < 1000) break;
  }
  const byCustomer = new Map(profiles.filter((p) => p.stripe_customer_id).map((p) => [p.stripe_customer_id!, p]));

  // One subscription per customer: the live one if any, else the newest.
  const subByCustomer = new Map<string, Stripe.Subscription>();
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const current = subByCustomer.get(customerId);
    const better = !current
      || (LIVE.has(sub.status) && !LIVE.has(current.status))
      || (LIVE.has(sub.status) === LIVE.has(current.status) && sub.created > current.created);
    if (better) subByCustomer.set(customerId, sub);
  }

  let problems = 0;
  const paidWithSub = new Set<string>();
  for (const [customerId, sub] of subByCustomer) {
    const priceId = sub.items.data[0]?.price.id ?? null;
    const plan = priceId ? planForPriceId(priceId) : null;
    const expected = LIVE.has(sub.status) ? plan : ENDED.has(sub.status) ? "free" : undefined;
    const profile = byCustomer.get(customerId);
    if (profile && LIVE.has(sub.status)) paidWithSub.add(profile.id);
    if (expected === undefined) continue;

    if (!profile) {
      if (LIVE.has(sub.status)) {
        problems++;
        console.log(`UNLINKED  customer ${customerId} · ${plan ?? priceId} · ${sub.status}: paying, but no account has this customer id`);
      }
      continue;
    }
    if (PROTECTED.has(profile.tier ?? "")) continue;
    if (expected === null) {
      problems++;
      console.log(`UNKNOWN PRICE  ${profile.id} · price ${priceId} · ${sub.status}: not STRIPE_PRICE_BASIC_MONTHLY or STRIPE_PRICE_PRO_MONTHLY`);
      continue;
    }
    if ((profile.tier ?? "free") === expected && profile.stripe_subscription_id === sub.id) continue;

    problems++;
    console.log(`MISMATCH  ${profile.id} · profile ${profile.tier ?? "(none)"} · Stripe ${expected} (${sub.status}, ${sub.id})`);
    if (APPLY) {
      const { error } = await supabase.from("profiles").update({
        stripe_subscription_id: sub.id,
        stripe_price_id: priceId,
        subscription_status: sub.status,
        current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
        tier: expected,
      }).eq("id", profile.id);
      console.log(error ? `  fix failed: ${error.message}` : "  fixed");
    }
  }

  // Paid tier with nothing paying for it. A legacy Pro grace grant is
  // expected to look like this until it expires.
  for (const p of profiles) {
    if ((p.tier !== "basic" && p.tier !== "pro") || paidWithSub.has(p.id)) continue;
    if (p.tier === "pro" && p.pro_grace_expires_at && new Date(p.pro_grace_expires_at) > new Date()) continue;
    problems++;
    console.log(`NO SUBSCRIPTION  ${p.id} · ${p.tier}: paid tier with no live Stripe subscription (report only)`);
  }

  console.log(`\n${profiles.length} profiles, ${subByCustomer.size} Stripe customers, ${problems} out of sync${APPLY ? "" : " (dry run)"}.`);
  if (problems > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
