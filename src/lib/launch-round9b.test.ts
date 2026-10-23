import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { insiderSelling, officersFromFilings } from "./insiders.js";
import { partyIs } from "./name-match.js";
import { sourceById } from "./coverage/registry.js";
import { foundingYear } from "../agents/website-agent/index.js";
import { isNationalScale } from "../agents/orchestrator/index.js";
import { lockedFacts } from "../agents/synthesis-agent/index.js";
import { plausibleAnalysis } from "./consistency.js";
import type { Form4Entry, ResearchBundle } from "../types/research.js";

const cfoSales: Form4Entry[] = [
  ["Mar 3, 2026", "$412,000"], ["Mar 10, 2026", "$398,000"], ["Mar 24, 2026", "$455,000"], ["Apr 7, 2026", "$470,000"], ["Apr 21, 2026", "$465,000"],
].map(([date, value]) => ({ filerName: "Jayme Brooks", relationship: "Chief Financial Officer", transactionType: "Sell", value, date, filingUrl: "https://www.secform4.com/x" }));
const evpSales: Form4Entry[] = ["Feb 2, 2026", "Mar 2, 2026", "Apr 2, 2026"].map((date) => ({ filerName: "Pat Doe", relationship: "EVP, Operations", transactionType: "Sale", value: "$90,000", date }));

describe("round nine (b): Limbach spot check (fix 83)", () => {
  it("large or repeated insider selling becomes a fact, with the total", () => {
    const facts = insiderSelling([...cfoSales, ...evpSales, { filerName: "Small Seller", transactionType: "Sell", value: "$20,000" }]);
    assert.match(facts[0].text, /Insider selling by 2 insiders: Jayme Brooks, Pat Doe/);
    assert.match(facts[1].text, /Jayme Brooks \(Chief Financial Officer\) sold about \$2\.2M in 5 sales \(Mar 3, 2026 to Apr 21, 2026\)/);
    assert.ok(!facts.some((f) => f.text.includes("Small Seller")));
  });

  it("an insider-selling risk survives synthesis's checks", () => {
    const bundle = { query: "x", generatedAt: "", company: { name: "Limbach Holdings" }, leadership: [], products: [], news: [], funding: [], competitors: [],
      insiderActivity: cfoSales, sources: [{ url: "https://www.secform4.com/x", title: "Form 4", retrievedAt: "", usedFor: ["insider-activity"] }] } as ResearchBundle;
    const facts = lockedFacts(bundle);
    assert.ok(facts.some((f) => f.text.startsWith("Insider selling: Jayme Brooks")));
    const kept = plausibleAnalysis(["CFO Jayme Brooks sold about $2.2M of stock in five sales from March to April 2026."], bundle, facts);
    assert.equal(kept.length, 1);
  });

  it("officers from insider filings join leadership; directors don't", () => {
    const out = officersFromFilings([...cfoSales, { filerName: "ANN DIRECTOR", relationship: "Director", filingUrl: "u" }]);
    assert.deepEqual(out.map((o) => `${o.name} | ${o.title}`), ["Jayme Brooks | Chief Financial Officer"]);
  });

  it("the founding year the site states wins over the model's", () => {
    assert.equal(foundingYear("1900", "Limbach has been building since 1901. Founded in 1901 in Pittsburgh."), "1901");
    assert.equal(foundingYear("1869", "Graybar was founded in 1869 and incorporated in 1925."), "1869");
    assert.equal(foundingYear("1864", "Graybar, a Fortune 500 distributor."), undefined);
    assert.equal(foundingYear("2017", "We opened our first clinic in 2017."), "2017");
  });

  it("a law firm of surnames is not the company", () => {
    assert.equal(partyIs("Limbach, Limbach & Sutton", ["Limbach Holdings", "Limbach"]), false);
    assert.equal(partyIs("Limbach Company LLC", ["Limbach Holdings"]), true);
  });

  it("a listed company is national, so its peers are", () => {
    assert.equal(isNationalScale({ description: "Limbach Holdings (NASDAQ: LMB) is a building systems solutions firm." }), true);
    assert.equal(isNationalScale({ description: "A family-owned HVAC contractor in Pasadena." }), false);
  });

  it("the funding-news source points at both sections it fills", () => {
    const s = sourceById("sec");
    assert.equal(s.name, "Funding news and insider filings (Form 4)");
    assert.equal(s.section, "Funding and Insider Activity");
  });
});
