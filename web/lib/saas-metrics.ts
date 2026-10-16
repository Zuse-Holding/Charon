import type Stripe from "stripe";

/**
 * Admin unit-economics metrics. Kept as pure functions over plain data so
 * the formulas are testable without Stripe (see saas-metrics.test.ts);
 * fetchStripeBilling() is the only part that talks to Stripe.
 *
 * Definitions (trailing window, default 30 days):
 * - MRR: sum of active + past_due subscriptions, normalized to monthly,
 *   at list price (coupons/discounts are not subtracted). Trials excluded.
 * - Churn: subscriptions live at window start that ended inside the window,
 *   divided by subscriptions live at window start.
 * - Gross margin: (net charges − Stripe fees − LLM cost) / net charges.
 *   Hosting and other infra costs aren't tracked, so this overstates it.
 * - CAC: logged acquisition spend / customers whose first subscription
 *   started in the window.
 * - LTV: ARPU × gross margin / monthly churn.
 */

export interface SubscriptionFact {
  customerId: string;
  status: Stripe.Subscription.Status;
  startedAt: number; // ms epoch
  endedAt: number | null; // ms epoch
  monthlyAmountUsd: number;
}

export interface BillingFacts {
  subscriptions: SubscriptionFact[];
  netChargesUsd: number; // charges minus refunds in the window
  stripeFeesUsd: number;
}

export interface CostFacts {
  llmCostUsd: number;
  acquisitionSpendUsd: number;
  acquisitionSpendEntries: number;
}

export interface SaasMetrics {
  windowDays: number;
  mrrUsd: number;
  payingCustomers: number;
  arpuUsd: number | null;
  churnRate: number | null; // 0–1, per window
  churnedCustomers: number;
  customersAtWindowStart: number;
  grossMargin: number | null; // 0–1, can go negative
  revenueUsd: number;
  cogsUsd: number;
  cacUsd: number | null;
  newCustomers: number;
  acquisitionSpendUsd: number;
  ltvUsd: number | null;
}

const MRR_STATUSES = new Set<Stripe.Subscription.Status>(["active", "past_due"]);
// Never actually paid — don't count as a customer gained or lost.
const NEVER_PAID = new Set<Stripe.Subscription.Status>(["incomplete", "incomplete_expired"]);

export function monthlyAmountUsd(price: Pick<Stripe.Price, "unit_amount" | "recurring"> | null, quantity = 1): number {
  if (!price?.unit_amount || !price.recurring) return 0;
  const perInterval = (price.unit_amount * quantity) / 100 / (price.recurring.interval_count || 1);
  switch (price.recurring.interval) {
    case "day": return perInterval * 365 / 12;
    case "week": return perInterval * 52 / 12;
    case "month": return perInterval;
    case "year": return perInterval / 12;
    default: return 0;
  }
}

export function computeSaasMetrics(
  billing: BillingFacts,
  costs: CostFacts,
  now: number,
  windowDays: number,
): SaasMetrics {
  const windowStart = now - windowDays * 86_400_000;
  const subs = billing.subscriptions.filter((s) => !NEVER_PAID.has(s.status));

  const live = subs.filter((s) => MRR_STATUSES.has(s.status));
  const mrrUsd = live.reduce((total, s) => total + s.monthlyAmountUsd, 0);
  const payingCustomers = new Set(live.map((s) => s.customerId)).size;
  const arpuUsd = payingCustomers > 0 ? mrrUsd / payingCustomers : null;

  // Trials that never converted aren't churned customers.
  const paidSubs = subs.filter((s) => s.status !== "trialing");
  const atStart = paidSubs.filter((s) => s.startedAt < windowStart && (s.endedAt === null || s.endedAt >= windowStart));
  const churned = atStart.filter((s) => s.endedAt !== null && s.endedAt <= now);
  const churnRate = atStart.length > 0 ? churned.length / atStart.length : null;

  const firstStartByCustomer = new Map<string, number>();
  for (const s of paidSubs) {
    const prev = firstStartByCustomer.get(s.customerId);
    if (prev === undefined || s.startedAt < prev) firstStartByCustomer.set(s.customerId, s.startedAt);
  }
  const newCustomers = [...firstStartByCustomer.values()].filter((t) => t >= windowStart && t <= now).length;

  const revenueUsd = billing.netChargesUsd;
  const cogsUsd = billing.stripeFeesUsd + costs.llmCostUsd;
  const grossMargin = revenueUsd > 0 ? (revenueUsd - cogsUsd) / revenueUsd : null;

  // No logged spend means CAC is unknown, not $0.
  const cacUsd = costs.acquisitionSpendEntries > 0 && newCustomers > 0
    ? costs.acquisitionSpendUsd / newCustomers
    : null;

  // Monthly churn is required for LTV; scale the window rate to 30 days.
  const monthlyChurn = churnRate !== null ? churnRate * (30 / windowDays) : null;
  const ltvUsd = arpuUsd !== null && grossMargin !== null && monthlyChurn
    ? (arpuUsd * grossMargin) / monthlyChurn
    : null;

  return {
    windowDays,
    mrrUsd,
    payingCustomers,
    arpuUsd,
    churnRate,
    churnedCustomers: churned.length,
    customersAtWindowStart: atStart.length,
    grossMargin,
    revenueUsd,
    cogsUsd,
    cacUsd,
    newCustomers,
    acquisitionSpendUsd: costs.acquisitionSpendUsd,
    ltvUsd,
  };
}

const REVENUE_TXN_TYPES = new Set(["charge", "payment", "refund", "payment_refund"]);

export async function fetchStripeBilling(stripe: Stripe, windowStartSec: number): Promise<BillingFacts> {
  const subscriptions: SubscriptionFact[] = [];
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    subscriptions.push({
      customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      status: sub.status,
      startedAt: sub.start_date * 1000,
      endedAt: sub.ended_at ? sub.ended_at * 1000 : null,
      monthlyAmountUsd: sub.items.data.reduce(
        (total, item) => total + monthlyAmountUsd(item.price, item.quantity ?? 1),
        0,
      ),
    });
  }

  let netCents = 0;
  let feeCents = 0;
  for await (const txn of stripe.balanceTransactions.list({ created: { gte: windowStartSec }, limit: 100 })) {
    if (!REVENUE_TXN_TYPES.has(txn.type)) continue;
    netCents += txn.amount;
    feeCents += txn.fee;
  }

  return { subscriptions, netChargesUsd: netCents / 100, stripeFeesUsd: feeCents / 100 };
}

/** One account's usage in the window, from the agent server. */
export interface AccountUsage {
  userId: string;
  name: string | null;
  tier: string | null;
  stripeCustomerId: string | null;
  reports: number;
  llmCostUsd: number;
}

export interface AccountEconomics {
  name: string;
  tier: string | null;
  reports: number;
  llmCostUsd: number; // scaled to 30 days
  costPerReportUsd: number | null;
  monthlyPriceUsd: number;
  marginUsd: number;
  // losing_money: pays something but costs more than it pays.
  // not_paying: runs reports with no live subscription (free, trial, internal).
  status: "ok" | "losing_money" | "not_paying";
}

export interface PastDueAccount {
  name: string;
  status: "past_due" | "unpaid";
  monthlyAmountUsd: number;
}

const accountName = (a: Pick<AccountUsage, "name" | "userId">) => a.name?.trim() || `Account ${a.userId.slice(0, 8)}`;

/** LLM cost per account against what its live Stripe subscriptions pay, costliest first. */
export function computeAccountEconomics(
  accounts: AccountUsage[],
  subscriptions: SubscriptionFact[],
  windowDays: number,
): AccountEconomics[] {
  const priceByCustomer = new Map<string, number>();
  for (const s of subscriptions) {
    if (!MRR_STATUSES.has(s.status)) continue;
    priceByCustomer.set(s.customerId, (priceByCustomer.get(s.customerId) ?? 0) + s.monthlyAmountUsd);
  }

  return accounts
    .filter((a) => a.reports > 0)
    .map((a) => {
      const llmCostUsd = a.llmCostUsd * (30 / windowDays);
      const monthlyPriceUsd = a.stripeCustomerId ? priceByCustomer.get(a.stripeCustomerId) ?? 0 : 0;
      const status: AccountEconomics["status"] =
        monthlyPriceUsd === 0 ? "not_paying" : llmCostUsd > monthlyPriceUsd ? "losing_money" : "ok";
      return {
        name: accountName(a),
        tier: a.tier,
        reports: a.reports,
        llmCostUsd,
        costPerReportUsd: a.llmCostUsd / a.reports,
        monthlyPriceUsd,
        marginUsd: monthlyPriceUsd - llmCostUsd,
        status,
      };
    })
    .sort((x, y) => y.llmCostUsd - x.llmCostUsd);
}

/** Subscriptions behind on payment: revenue at risk of involuntary churn. */
export function computePastDue(
  subscriptions: SubscriptionFact[],
  accounts: AccountUsage[],
): { accounts: PastDueAccount[]; mrrAtRiskUsd: number } {
  const byCustomer = new Map(accounts.filter((a) => a.stripeCustomerId).map((a) => [a.stripeCustomerId!, a]));
  const behind = subscriptions
    .filter((s): s is SubscriptionFact & { status: "past_due" | "unpaid" } => s.status === "past_due" || s.status === "unpaid")
    .map((s) => {
      const account = byCustomer.get(s.customerId);
      return {
        name: account ? accountName(account) : s.customerId,
        status: s.status,
        monthlyAmountUsd: s.monthlyAmountUsd,
      };
    })
    .sort((x, y) => y.monthlyAmountUsd - x.monthlyAmountUsd);
  return { accounts: behind, mrrAtRiskUsd: behind.reduce((t, a) => t + a.monthlyAmountUsd, 0) };
}
