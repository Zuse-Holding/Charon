import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNewsNoise, isPersonalLifeNews, isShoppingOrQuote, namesItself } from "./news-noise.js";
import { applyEntityType, applySecFilings } from "../agents/orchestrator/index.js";
import { aboutOthersOnly, type Fact } from "../agents/synthesis-agent/index.js";
import { isStoreListing } from "../agents/website-agent/index.js";
import type { ResearchBundle } from "../types/research.js";
import type { SecFilings } from "../agents/sec-filings-agent/index.js";

const bundle = (over: Partial<ResearchBundle> & { company?: ResearchBundle["company"] }): ResearchBundle => ({
  query: "x", generatedAt: "", company: { name: "x" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
}) as ResearchBundle;

describe("round seven: #77 regressions", () => {
  it("a review site is never news, and a review of a competitor is never an opportunity", () => {
    assert.equal(isNewsNoise("https://www.yelp.com/biz/autism-spectrum-therapies-valencia"), true);
    const facts: Fact[] = [{ text: "Competitor: Autism Spectrum Therapies", url: "u1" }, { text: "Location: Valencia, CA", url: "u2" }];
    assert.equal(aboutOthersOnly([1], facts), true);
    assert.equal(aboutOthersOnly([1, 2], facts), false);
  });

  it("store sales are shopping; selling a business is not", () => {
    assert.equal(isShoppingOrQuote("Patagonia's Worn Wear sale is back", "https://n.example/a"), true);
    assert.equal(isShoppingOrQuote("Patagonia web specials: save up to 50%", "https://n.example/b"), true);
    assert.equal(isShoppingOrQuote("Patagonia fleece: up to 40% today", "https://n.example/d"), true);
    assert.equal(isShoppingOrQuote("Limbach completes sale of its Southern California unit", "https://n.example/c"), false);
  });

  it("the Patagonia region is not Patagonia the company", () => {
    assert.equal(namesItself("Data center planned for Argentina's Patagonia", "Patagonia"), false);
    assert.equal(namesItself("New data center in the Patagonia region", "Patagonia"), false);
    assert.equal(namesItself("Patagonia sues retailer over logo", "Patagonia"), true);
  });

  it("tabloid hosts are personal-life news", () => {
    assert.equal(isPersonalLifeNews("Crumbl co-founder spotted at party", undefined, "https://www.dailymail.com/x"), true);
  });

  it("venture rounds decades after founding belong to a namesake", () => {
    const b = bundle({ company: { name: "Patagonia", founded: "1973" },
      funding: [{ round: "Seed", amount: "$8.7M", date: "2021" }, { round: "Series A", amount: "$30M" }] });
    applyEntityType(b, false, new Date("2026-10-23"));
    assert.deepEqual(b.funding, []);
    assert.notEqual(b.company.entityType, "venture");
    const g = bundle({ company: { name: "Gecko Robotics", founded: "2013" }, funding: [{ round: "Series D", amount: "$125M", date: "Jun 2025" }] });
    applyEntityType(g, false, new Date("2026-10-23"));
    assert.equal(g.funding.length, 1);
  });

  it("a public company is nobody's subsidiary; the 10-K's founding year wins", () => {
    const sec = { financials: [{ year: "2025", revenue: 646.8e6 }], tenKUrl: "https://sec.example/10k", founded: "1901", executiveOfficers: [], riskFactors: [] } as unknown as SecFilings;
    const b = bundle({ company: { name: "Limbach Holdings", founded: "2016" }, ownership: "Wholly-owned subsidiary of 1347 Capital", secFilings: sec });
    applySecFilings(b, sec);
    applyEntityType(b, false);
    assert.equal(b.company.entityType, "public");
    assert.equal(b.ownership, undefined);
    assert.equal(b.company.founded, "1901");
  });

  it("a listing that links to a store page is one store of a chain", () => {
    assert.equal(isStoreListing({ website: "https://crumblcookies.com/njholmdel" }), true);
    assert.equal(isStoreListing({ website: "https://promiseaba.com/" }), false);
    assert.equal(isStoreListing({ website: "https://promiseaba.com/home?utm_source=gmb" }), false);
  });
});
