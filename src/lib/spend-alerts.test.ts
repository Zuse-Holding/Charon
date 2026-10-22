import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spendAlerts } from "./spend-alerts.js";

const limits = { perReportUsd: 0.5, dailyUsd: 25 };
const report = (costUsd: number) => ({ kind: "company report", subject: "Acme", costUsd });

describe("spend alerts", () => {
  it("stays quiet for a normal report on a normal day", () => {
    assert.deepEqual(spendAlerts(report(0.04), 3, limits), []);
  });

  it("flags one expensive report", () => {
    const [a, ...rest] = spendAlerts(report(0.75), 5, limits);
    assert.equal(rest.length, 0);
    assert.match(a.subject, /one report cost \$0\.75/);
    assert.match(a.text, /"Acme"/);
  });

  it("sends the daily alert only on the report that crosses the line", () => {
    assert.equal(spendAlerts(report(0.1), 24.95, limits).length, 0);
    const crossing = spendAlerts(report(0.1), 25.05, limits);
    assert.equal(crossing.length, 1);
    assert.match(crossing[0].subject, /\$25\.05 today/);
    assert.equal(spendAlerts(report(0.1), 25.15, limits).length, 0);
  });

  it("can send both at once", () => {
    assert.equal(spendAlerts(report(2), 26, limits).length, 2);
  });
});

describe("cost split write (launch P1)", () => {
  it("retries without the split columns when the migration hasn't run, then stops sending them", async () => {
    const { writeWithCostSplit } = await import("./cost-tracking.js");
    const seen: object[] = [];
    const write = async (split: object) => {
      seen.push(split);
      return { error: "model_cost_usd" in split ? { code: "PGRST204", message: "Could not find the 'model_cost_usd' column" } : null };
    };
    assert.equal((await writeWithCostSplit({ model_cost_usd: 0.01, search_calls: 9 }, write)).error, null);
    await writeWithCostSplit({ model_cost_usd: 0.02, search_calls: 3 }, write);
    assert.deepEqual(seen, [{ model_cost_usd: 0.01, search_calls: 9 }, {}, {}]);
  });
});
