import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { namesItself } from "./news-noise.js";
import { corporateActions } from "./corporate-actions.js";
import { mergeRuleRisks, type RuleRisk } from "./risk-rules.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

describe("round fourteen (b): dev handoff, Oct 23", () => {
  it("leadership with its own source links survives losing the tagged pages", () => {
    const report = new ReportAgent().generate({ query: "x", generatedAt: "", company: { name: "ACCO Engineered Systems" }, products: [], news: [], funding: [], competitors: [], sources: [],
      leadership: [{ name: "Chuck Darway", title: "President", sourceUrl: "https://www.businesswire.com/news/home/x" }] } as ResearchBundle);
    assert.match(report, /## Leadership\n- \*\*Chuck Darway\*\* — President/);
    assert.match(report, /\[businesswire\.com\]\(https:\/\/www\.businesswire\.com\/news\/home\/x\)/);
  });

  it("a second open case still gets its risk when the model wrote about the first", () => {
    const chang = "https://www.courtlistener.com/docket/72031250/chang-v-acco/";
    const nw = "https://www.courtlistener.com/docket/74735547/northwest-administrators-v-acco/";
    const risk = "ACCO is the defendant in Chang v. Acco Engineered Systems.";
    const rule: RuleRisk = { text: "2 open federal cases against the company were filed since 2026, most recently Northwest Administrators Inc v. Acco Engineered Systems Inc.", urls: [nw, chang], key: "open-cases" };
    const merged = mergeRuleRisks([risk], { [risk]: [chang] }, [rule]);
    assert.equal(merged.risks.length, 2);
    // Every case already cited: nothing added.
    assert.equal(mergeRuleRisks([risk], { [risk]: [chang, nw] }, [rule]).risks.length, 1);
  });

  it("a social post is no record of an acquisition", () => {
    const acts = corporateActions([
      { text: "MJW Investments acquires Atlanta portfolio!", url: "https://www.facebook.com/mjwinvestments/posts/1" },
      { text: "MJW Investments acquires Coventry Square Apartments", url: "https://www.bizjournals.com/x" },
    ], ["MJW Investments"]);
    assert.deepEqual(acts.map((a) => a.name), ["Coventry Square Apartments"]);
  });

  it("a health plan's name is not the company's", () => {
    assert.equal(namesItself("Aetna Mountain Health Promise ABA Coverage: A Family Guide", "Promise ABA"), false);
    assert.equal(namesItself("Families in Valencia choose Promise ABA for early intervention", "Promise ABA"), true);
  });
});
