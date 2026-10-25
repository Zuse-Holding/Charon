import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOfferingRisk } from "./risk-rules.js";
import { carryForward, type EarlierRun } from "./profile-cache.js";
import { titlesFromNews } from "./leadership.js";
import { lockedFacts } from "../agents/synthesis-agent/index.js";
import { pageYears } from "../agents/propublica-nonprofit-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const bundleOf = (over: Partial<ResearchBundle>): ResearchBundle => ({
  query: "x", generatedAt: "2026-10-25T00:00:00Z", company: { name: "X" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
} as ResearchBundle);

describe("round sixteen (c): Form D, carried facts, news titles, 990 page", () => {
  it("a Form D that sold under its offering is never a risk (Gecko)", () => {
    assert.equal(isOfferingRisk("The Form D filing for Gecko Robotics, Inc. on 2019-04-30 shows $9,126,888 sold of $9,133,300 offered, indicating that not all offered funding was secured."), true);
    assert.equal(isOfferingRisk("Gecko Robotics has a significant concentration on a single customer, the U.S. Navy, with a $300 million IDIQ contract."), false);
  });

  it("each Form D cites its own filing", () => {
    const facts = lockedFacts(bundleOf({
      sources: [{ url: "https://www.sec.gov/Archives/edgar/data/1/2025/", title: "Form D 2025", retrievedAt: "", usedFor: ["funding"] }],
      funding: [
        { round: "Form D: Gecko Robotics, Inc.", amount: "$121,534,561 sold of $139,900,000 offered", date: "2025-06-12", url: "https://www.sec.gov/Archives/edgar/data/1/2025/" },
        { round: "Form D: Gecko Robotics, Inc.", amount: "$9,126,888 sold of $9,133,300 offered", date: "2019-04-30", url: "https://www.sec.gov/Archives/edgar/data/1/2019/" },
      ],
    }));
    assert.deepEqual(facts.filter((f) => f.kind === "funding").map((f) => f.url),
      ["https://www.sec.gov/Archives/edgar/data/1/2025/", "https://www.sec.gov/Archives/edgar/data/1/2019/"]);
  });

  it("carries leaders, products, rounds and acquisitions an earlier run found itself", () => {
    const bundle = bundleOf({ company: { name: "Homeboy Industries" },
      leadership: [{ name: "Steve Delgado", title: "Co-Chief Executive Officer", sourceUrl: "https://homeboyindustries.org/our-story/our-leaders/" }] });
    const runs: EarlierRun[] = [{
      leadership: [
        { name: "Shirley Torres", title: "Co-Chief Executive Officer", sourceUrl: "https://homeboyindustries.org/our-story/our-leaders/" },
        { name: "Steven Delgado", title: "Co-CEO", sourceUrl: "https://homeboyindustries.org/x" },
        { name: "Pat Roe", title: "CFO", sourceUrl: "https://rocketreach.co/x", lowConfidence: true },
        { name: "Lee Moe", title: "COO", sourceUrl: "https://somesite.example/x" },
        { name: "Kim Doe", title: "CTO", sourceUrl: "https://homeboyindustries.org/y", carried: true },
      ],
      products: [{ name: "Homeboy Bakery", sourceUrl: "https://homeboyindustries.org/bakery" }, { name: "Elsewhere", sourceUrl: "https://other.example/p" }],
      funding: [{ round: "Series B", amount: "$40M", date: "2022" }, { round: "Form D: X", amount: "$1 sold" }, { round: "Fund I (target)", amount: "$100M" }],
      corporateActions: [{ kind: "Acquisition", name: "Pioneer Power", date: "2026-07-01", url: "https://news.example/a" }],
    }];
    const added = carryForward(bundle, runs, "homeboyindustries.org");
    assert.deepEqual(bundle.leadership.map((l) => l.name), ["Steve Delgado", "Shirley Torres"]);
    assert.equal(bundle.leadership[1].carried, true);
    assert.deepEqual(bundle.products.map((p) => p.name), ["Homeboy Bakery"]);
    assert.deepEqual(bundle.funding.map((f) => f.round), ["Series B"]);
    assert.deepEqual(bundle.corporateActions?.map((a) => a.name), ["Pioneer Power"]);
    assert.equal(added.length, 4);
    // A second earlier run with the same facts adds nothing twice.
    assert.equal(carryForward(bundle, runs, "homeboyindustries.org").length, 0);
  });

  it("adds a title the news gives someone listed, never a former one (Demmer)", () => {
    const news = [{ headline: "Gecko Robotics eyes further fleet work growth", date: "Oct 22, 2026", url: "https://janes.com/x",
      articleText: "impact for Gecko Robotics' technology, according to Troy Demmer, company president and co-founder." }];
    const out = titlesFromNews([{ name: "Troy Demmer", title: "Cofounder" }, { name: "Jake Loosararian", title: "CEO" }], news);
    assert.equal(out[0].title, "Cofounder, President");
    assert.equal(out[1].title, "CEO");
    const former = titlesFromNews([{ name: "Pat Rivera", title: "Founder" }],
      [{ headline: "x", date: "Oct 1, 2026", url: "https://x.example", summary: "said Pat Rivera, the company's former president." }]);
    assert.equal(former[0].title, "Founder");
  });

  it("reads a 990 year from ProPublica's current page wording (Homeboy 2024)", () => {
    const html = `<h3>Fiscal Year Ending Dec. 2025</h3><p>No Extracted Financial Data</p>
      <h3>Fiscal Year Ending Dec. 2024</h3><p>Extracted Financial Data from Form 990</p><p>Revenue $46,951,306</p><p>Expenses $41,682,660</p>
      <p>Percent of Total Revenue</p><p>Contributions $36,000,436</p><p>Total Assets $110,036,544</p>`;
    assert.deepEqual(pageYears(html), [{ year: "2024", revenue: 46951306, expenses: 41682660, assets: 110036544, contributions: 36000436 }]);
  });
});
