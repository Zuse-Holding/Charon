import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedFacts, resolveCitations, type Fact } from "./index.js";
import { RisksOpportunitiesSchema } from "../../lib/llm.js";
import type { ResearchBundle, Source } from "../../types/research.js";

const src = (url: string, usedFor: string[]): Source => ({ url, usedFor, retrievedAt: "2026-10-17T00:00:00Z" });

test("locked facts list what the report states, and say when there's no funding", () => {
  const bundle = {
    company: { name: "Juice Equity", description: "Buys small businesses.", website: "https://juiceequity.com" },
    leadership: [{ name: "Nick Olmos", title: "Founder", sourceUrl: "https://juiceequity.com/about" }],
    products: [], competitors: [], funding: [], news: [], sources: [],
  } as unknown as ResearchBundle;
  const facts = lockedFacts(bundle);
  assert.deepEqual(facts.map((f) => f.text), [
    "What it does: Buys small businesses.",
    "Leadership: Nick Olmos, Founder",
    "Funding: no public funding records found",
  ]);
  assert.equal(facts[1].url, "https://juiceequity.com/about");
});

test("cited items are kept and their sources tagged; uncited or out-of-range items are dropped", () => {
  const facts: Fact[] = [{ text: "News: x", url: "https://a.com" }, { text: "Competitor: PayPal", url: "https://c.com" }];
  const sources = [src("https://a.com", ["news"]), src("https://c.com", ["competitors"])];
  const kept = resolveCitations(
    [
      { text: "PayPal competition", sources: [2, 2] },
      { text: "No citation", sources: [] },
      { text: "Bad citation", sources: [9] },
    ],
    facts,
    sources,
    "risks"
  );
  assert.deepEqual(kept, [{ text: "PayPal competition", facts: [2], urls: ["https://c.com"] }]);
  assert.deepEqual(sources[1].usedFor, ["competitors", "risks"]);
  assert.deepEqual(sources[0].usedFor, ["news"]);
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
