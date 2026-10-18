import { test } from "node:test";
import assert from "node:assert/strict";
import { citableSources, resolveCitations } from "./index.js";
import { RisksOpportunitiesSchema } from "../../lib/llm.js";
import type { Source } from "../../types/research.js";

const src = (url: string, usedFor: string[]): Source => ({ url, usedFor, retrievedAt: "2026-10-17T00:00:00Z" });

test("only input-section sources are citable, deduped by url", () => {
  const pool = citableSources([
    src("https://a.com", ["news"]),
    src("https://a.com", ["funding"]),
    src("https://b.com", ["domain-posture"]),
    src("https://c.com", ["competitors"]),
  ]);
  assert.deepEqual(pool.map((s) => s.url), ["https://a.com", "https://c.com"]);
});

test("cited items are kept and their sources tagged; uncited or out-of-range items are dropped", () => {
  const pool = [src("https://a.com", ["news"]), src("https://c.com", ["competitors"])];
  const kept = resolveCitations(
    [
      { text: "PayPal competition", sources: [2, 2] },
      { text: "No citation", sources: [] },
      { text: "Bad citation", sources: [9] },
    ],
    pool,
    "risks"
  );
  assert.deepEqual(kept, [{ text: "PayPal competition", urls: ["https://c.com"] }]);
  assert.deepEqual(pool[1].usedFor, ["competitors", "risks"]);
  assert.deepEqual(pool[0].usedFor, ["news"]);
});

test("schema reads cited objects and treats bare strings as uncited", () => {
  const parsed = RisksOpportunitiesSchema.parse({
    risks: [{ text: "A", sources: [1, "2"] }, "B"],
    opportunities: [{ opportunity: "C", sources: 3 }],
  });
  assert.deepEqual(parsed.risks, [
    { text: "A", sources: [1, 2] },
    { text: "B", sources: [] },
  ]);
  assert.deepEqual(parsed.opportunities, [{ text: "C", sources: [3] }]);
});
