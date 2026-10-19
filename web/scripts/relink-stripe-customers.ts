/**
 * Rebuild only: re-attach paying Stripe customers to their accounts in a new
 * Supabase project (see supabase/rebuild/README.md).
 *
 * The Stripe webhook finds a user by profiles.stripe_customer_id. A fresh
 * project has no such links, so subscribers would silently fall back to Free
 * and their renewals would be ignored. This matches each live subscription's
 * customer email to an account that has signed up again with that email, and
 * writes the same fields the webhook writes.
 *
 * Dry run by default: prints what it would do and changes nothing.
 *   cd web && npx tsx --env-file=.env.local scripts/relink-stripe-customers.ts
 *   cd web && npx tsx --env-file=.env.local scripts/relink-stripe-customers.ts --apply
 *
 * Needs STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC_MONTHLY, STRIPE_PRICE_PRO_MONTHLY,
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the NEW project's).
 * Safe to re-run: as more people sign up again, run it again to pick them up.
 */
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripe, planForPriceId } from "../lib/stripe";

const APPLY = process.argv.includes("--apply");
// The same statuses the webhook grants access for, plus past_due, which keeps
// access while Stripe retries the payment.
const LIVE = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the new project.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const stripe = getStripe();

  // Every account in the new project, by email.
  const idByEmail = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) idByEmail.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) break;
  }

  let linked = 0;
  const waiting: string[] = [];
  for await (const sub of stripe.subscriptions.list({ status: "all", expand: ["data.customer"], limit: 100 })) {
    if (!LIVE.has(sub.status)) continue;
    const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer;
    const email = "email" in customer && customer.email ? customer.email.toLowerCase() : null;
    const priceId = sub.items.data[0]?.price.id ?? null;
    const plan = priceId ? planForPriceId(priceId) : null;
    const userId = email ? idByEmail.get(email) : undefined;

    if (!email || !userId) {
      waiting.push(`${email ?? `(no email, customer ${customer.id})`} · ${plan ?? priceId} · ${sub.status}`);
      continue;
    }

    const state = {
      stripe_customer_id: customer.id,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      subscription_status: sub.status,
      current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
      // past_due keeps the paid tier, as the webhook does while Stripe retries.
      tier: plan,
    };
    console.log(`${APPLY ? "link" : "would link"}  ${email} -> ${userId} · ${plan} · ${sub.status}`);
    if (APPLY) {
      const { error } = await supabase.from("profiles").upsert({ id: userId, ...state });
      if (error) {
        console.error(`  failed: ${error.message}`);
        continue;
      }
    }
    linked++;
  }

  console.log(`\n${APPLY ? "Linked" : "Would link"} ${linked} subscriber(s).`);
  if (waiting.length) {
    console.log(`${waiting.length} subscriber(s) haven't signed up again yet (run this again once they have):`);
    for (const w of waiting) console.log(`  ${w}`);
  }
  if (!APPLY) console.log("\nDry run: nothing was changed. Re-run with --apply to write these links.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
