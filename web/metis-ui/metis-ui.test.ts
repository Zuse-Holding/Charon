// Shared number formats and quota wording. Runs from the Charon root
// (npm test); not copied into committee-app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { confidence, money, multiple, percent } from "./format";
import { quotaStatus, quotaText } from "./quota";
import { citeText, looksLikeKey } from "./cite";
import { stepStates } from "./steps";

test("one number format everywhere", () => {
  assert.equal(money(1_190_000), "$1.19M");
  assert.equal(money(845_000), "$845K");
  assert.equal(money(-1_200_000), "−$1.2M");
  assert.equal(money(940), "$940");
  assert.equal(multiple(3.333), "3.33x");
  assert.equal(percent(56.2), "56%");
  assert.equal(percent(4.83), "4.8%");
  assert.equal(percent(12, { sign: true }), "+12%");
  assert.equal(confidence(0.55), "55%");
  assert.equal(money(null), "—");
});

test("quota line", () => {
  assert.equal(quotaText({ used: 3, limit: 25, unit: "profiles", resets: "Nov 1" }), "3 of 25 profiles used · resets Nov 1");
  assert.equal(quotaStatus(20, 25), "warn");
  assert.equal(quotaStatus(25, 25), "danger");
  assert.equal(quotaStatus(3, 25), "ok");
});

test("stepper states", () => {
  assert.deepEqual(stepStates(4, 2), ["done", "done", "now", "todo"]);
  assert.deepEqual(stepStates(3, 1, true), ["done", "failed", "todo"]);
  assert.deepEqual(stepStates(2, 2), ["done", "done"]);
  assert.deepEqual(stepStates(2, -1), ["todo", "todo"]);
});

test("one citation wording, never a raw key", () => {
  assert.equal(citeText("Harbor Line CIM.pdf", 14), "Harbor Line CIM.pdf, p. 14");
  assert.equal(citeText("Financials.xlsx", "B12"), "Financials.xlsx, B12");
  assert.equal(citeText("axios.com", "Aug 19, 2026"), "axios.com · Aug 19, 2026");
  assert.equal(citeText("stripe.com"), "stripe.com");
  assert.equal(citeText("P&L 2022-2024.xlsx", "'P&L'!D31"), "P&L 2022-2024.xlsx, 'P&L'!D31");
  assert.equal(citeText("Market data", "as of Oct 16, 1:42 PM"), "Market data · as of Oct 16, 1:42 PM");
  assert.ok(looksLikeKey("is.2023.revenue"));
  assert.ok(looksLikeKey("ab_3"));
  assert.ok(!looksLikeKey("Harbor Line CIM.pdf"));
});
