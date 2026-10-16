// Run: npx tsx --test web/lib/saas-metrics.test.ts (from the repo root)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccountEconomics, computePastDue, computeSaasMetrics, monthlyAmountUsd, type AccountUsage, type SubscriptionFact } from "./saas-metrics";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 15);
const ago = (days: number) => NOW - days * DAY;

const sub = (customerId: string, startedDaysAgo: number, extra: Partial<SubscriptionFact> = {}): SubscriptionFact => ({
  customerId, status: "active", startedAt: ago(startedDaysAgo), endedAt: null, monthlyAmountUsd: 49, ...extra,
});

const noCosts = { llmCostUsd: 0, acquisitionSpendUsd: 0, acquisitionSpendEntries: 0 };

test("monthlyAmountUsd normalizes intervals", () => {
  assert.equal(monthlyAmountUsd({ unit_amount: 1900, recurring: { interval: "month", interval_count: 1 } } as never), 19);
  assert.equal(monthlyAmountUsd({ unit_amount: 24000, recurring: { interval: "year", interval_count: 1 } } as never), 20);
  assert.equal(monthlyAmountUsd({ unit_amount: 4900, recurring: { interval: "month", interval_count: 1 } } as never, 2), 98);
  assert.equal(monthlyAmountUsd({ unit_amount: 1900, recurring: null } as never), 0);
});

test("full scenario: MRR, churn, margin, CAC, LTV", () => {
  const subscriptions = [
    sub("a", 90),
    sub("b", 90, { monthlyAmountUsd: 19, status: "past_due" }),
    sub("c", 90, { status: "canceled", endedAt: ago(10) }), // churned in window
    sub("d", 90, { status: "canceled", endedAt: ago(45) }), // churned before window
    sub("e", 5), // new
    sub("f", 3, { status: "trialing" }), // trial: not MRR, not new
    sub("g", 2, { status: "incomplete_expired" }), // never paid
  ];
  const m = computeSaasMetrics(
    { subscriptions, netChargesUsd: 1000, stripeFeesUsd: 40 },
    { llmCostUsd: 60, acquisitionSpendUsd: 300, acquisitionSpendEntries: 2 },
    NOW, 30,
  );
  assert.equal(m.mrrUsd, 49 + 19 + 49);
  assert.equal(m.payingCustomers, 3);
  assert.equal(m.customersAtWindowStart, 3); // a, b, c
  assert.equal(m.churnedCustomers, 1);
  assert.equal(m.churnRate, 1 / 3);
  assert.equal(m.grossMargin, 0.9);
  assert.equal(m.newCustomers, 1);
  assert.equal(m.cacUsd, 300);
  assert.ok(Math.abs(m.ltvUsd! - (117 / 3) * 0.9 * 3) < 1e-9);
});

test("returning customer with a new subscription is not counted as new", () => {
  const m = computeSaasMetrics(
    { subscriptions: [sub("a", 200, { status: "canceled", endedAt: ago(100) }), sub("a", 4)], netChargesUsd: 49, stripeFeesUsd: 0 },
    { ...noCosts, acquisitionSpendUsd: 100, acquisitionSpendEntries: 1 },
    NOW, 30,
  );
  assert.equal(m.newCustomers, 0);
  assert.equal(m.cacUsd, null);
});

test("unknowns stay null instead of fake zeros", () => {
  const m = computeSaasMetrics({ subscriptions: [sub("a", 5)], netChargesUsd: 0, stripeFeesUsd: 0 }, noCosts, NOW, 30);
  assert.equal(m.churnRate, null); // no history at window start
  assert.equal(m.grossMargin, null); // no revenue
  assert.equal(m.cacUsd, null); // no spend logged
  assert.equal(m.ltvUsd, null);
});

test("zero churn gives no LTV estimate rather than infinity", () => {
  const m = computeSaasMetrics({ subscriptions: [sub("a", 90)], netChargesUsd: 49, stripeFeesUsd: 2 }, noCosts, NOW, 30);
  assert.equal(m.churnRate, 0);
  assert.equal(m.ltvUsd, null);
});

const acct = (userId: string, extra: Partial<AccountUsage> = {}): AccountUsage => ({
  userId, name: `User ${userId}`, tier: "basic", stripeCustomerId: null, reports: 10, llmCostUsd: 5, ...extra,
});

test("account economics: cost vs live subscription price", () => {
  const subs = [
    sub("cus_heavy", 60, { monthlyAmountUsd: 19 }),
    sub("cus_light", 60, { monthlyAmountUsd: 49 }),
    sub("cus_gone", 60, { monthlyAmountUsd: 19, status: "canceled", endedAt: ago(5) }),
  ];
  const rows = computeAccountEconomics([
    acct("heavy", { stripeCustomerId: "cus_heavy", reports: 40, llmCostUsd: 25 }),
    acct("light", { stripeCustomerId: "cus_light", reports: 4, llmCostUsd: 2 }),
    acct("gone", { stripeCustomerId: "cus_gone", reports: 2, llmCostUsd: 1 }),
    acct("free", { reports: 3, llmCostUsd: 0.6 }),
    acct("idle", { reports: 0, llmCostUsd: 0 }),
  ], subs, 30);

  assert.deepEqual(rows.map((r) => r.name), ["User heavy", "User light", "User gone", "User free"]); // costliest first, idle dropped
  assert.equal(rows[0].status, "losing_money");
  assert.equal(rows[0].marginUsd, 19 - 25);
  assert.equal(rows[0].costPerReportUsd, 25 / 40);
  assert.equal(rows[1].status, "ok");
  assert.equal(rows[2].status, "not_paying"); // canceled sub doesn't count as paying
  assert.equal(rows[3].status, "not_paying");
});

test("account economics scales cost to 30 days", () => {
  const [row] = computeAccountEconomics([acct("a", { llmCostUsd: 3 })], [], 15);
  assert.equal(row.llmCostUsd, 6);
});

test("past due: lists past_due and unpaid with revenue at risk", () => {
  const subs = [
    sub("cus_a", 60, { status: "past_due", monthlyAmountUsd: 49 }),
    sub("cus_b", 60, { status: "unpaid", monthlyAmountUsd: 19 }),
    sub("cus_c", 60),
  ];
  const r = computePastDue(subs, [acct("a", { stripeCustomerId: "cus_a" })]);
  assert.equal(r.mrrAtRiskUsd, 68);
  assert.deepEqual(r.accounts.map((a) => [a.name, a.status]), [["User a", "past_due"], ["cus_b", "unpaid"]]);
  assert.equal(computePastDue([sub("cus_c", 60)], []).mrrAtRiskUsd, 0);
});
