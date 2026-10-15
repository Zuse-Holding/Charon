// Run: npx tsx --test web/lib/saas-metrics.test.ts (from the repo root)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSaasMetrics, monthlyAmountUsd, type SubscriptionFact } from "./saas-metrics";

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
