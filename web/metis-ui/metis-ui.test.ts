// Shared number formats and quota wording. Runs from the Charon root
// (npm test); not copied into committee-app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { confidence, money, multiple, percent } from "./format";
import { quotaStatus, quotaText } from "./quota";

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
