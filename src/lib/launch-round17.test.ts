import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filerIsDomain, recentFiling } from "../agents/sec-filings-agent/index.js";
import { issuerIsCompany } from "../agents/public-filings-agent/index.js";
import { fundingOrder } from "../agents/report-agent/index.js";
import { composeSummary } from "./summary.js";
import { samePerson } from "./leadership.js";
import { corporateActions, dealDate } from "./corporate-actions.js";
import { carryForward } from "./profile-cache.js";
import { mergeRuleRisks } from "./risk-rules.js";
import type { ResearchBundle } from "../types/research.js";

const now = Date.parse("2026-10-25");
const bundleOf = (over: Partial<ResearchBundle>): ResearchBundle => ({
  query: "x", generatedAt: "2026-10-25T00:00:00Z", company: { name: "X" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
} as ResearchBundle);

describe("round seventeen: SEC by confirmed CIK, Form D issuers, social deals, swings", () => {
  it("confirms a filer by the SEC's website field or the domain in its 10-K, never by name (Patagonia Gold)", () => {
    assert.equal(filerIsDomain("graybar.com", { website: "https://www.graybar.com/" }), true);
    assert.equal(filerIsDomain("limbachinc.com", {}, "<p>Our internet address is www.limbachinc.com.</p>"), true);
    assert.equal(filerIsDomain("patagonia.com", { website: "http://www.patagoniagold.com" }, "<p>Visit patagoniagold.com</p>"), false);
    assert.equal(filerIsDomain("graybar.com", {}, "<p>notgraybar.com</p>"), false);
  });

  it("only recent filings count as latest results", () => {
    assert.equal(recentFiling("2026-08-05", now), true);
    assert.equal(recentFiling("2020-03-01", now), false);
  });

  it("counts a Form D only when the company is the issuer (Gecko, Patagonia, MJW)", () => {
    const gecko = ["Gecko Robotics", "Gecko Robotics, Inc."];
    assert.equal(issuerIsCompany("Gecko Robotics, Inc.", gecko), true);
    assert.equal(issuerIsCompany("HII Gecko Robotics Series I, a Series of Gecko Robotics, LLC", gecko), false);
    assert.equal(issuerIsCompany("Soma Capital Gecko Robotics SPV, LP", gecko), false);
    assert.equal(issuerIsCompany("Gecko Robotics Fund I, a series of GSBacker Fund, LP", gecko), false);
    for (const i of ["Patagonia Sur LLC", "Patagonia Health, Inc.", "Project Patagonia LLC", "Patagonia Capital Partners, LLC"]) {
      assert.equal(issuerIsCompany(i, ["Patagonia", "Patagonia, Inc."]), false, i);
    }
    assert.equal(issuerIsCompany("MJW Investments Student Housing Fund, LLC", ["MJW Investments"], "MJW"), true);
  });

  it("the summary names no Form D, no old fiscal year, and leads with the largest priced round", () => {
    const s = composeSummary(bundleOf({
      company: { name: "Gecko Robotics", description: "Gecko Robotics provides robots for infrastructure inspection.", founded: "2013", headquarters: "Pittsburgh, PA" },
      funding: [
        { round: "Series C", amount: "$100M" },
        { round: "Form D: HII Gecko Robotics Series I, a Series of Gecko Robotics, LLC", amount: "$1,560,000 sold of $1,560,000 offered", date: "2025-08-19" },
        { round: "Series D", amount: "$125M", date: "Jun 2025" },
      ],
      secFilings: { cik: "1", name: "Other", financials: [{ year: "2019", end: "2019-12-31", revenue: 21_900_000 }], riskFactors: [], executiveOfficers: [] },
    }), now) ?? "";
    assert.doesNotMatch(s, /Form D|HII|FY2019|21\.9/);
    assert.match(s, /Series D \(\$125M, Jun 2025\) and Series C \(\$100M\)/);
  });

  it("lists priced rounds before Form D filings, newest first", () => {
    const out = fundingOrder([{ round: "Form D: Gecko Robotics, Inc.", date: "2025-06-12" }, { round: "Series B", date: "2018" }, { round: "Series D", date: "2025-06-01" }]);
    assert.deepEqual(out.map((f) => f.round), ["Series D", "Series B", "Form D: Gecko Robotics, Inc."]);
  });

  it("an initial is the same person (Graybar's K. M. Mazzarella)", () => {
    assert.equal(samePerson("K. M. Mazzarella", "Kathleen M. Mazzarella"), true);
    assert.equal(samePerson("K. M. Mazzarella", "Robert Mazzarella"), false);
  });

  it("never takes a deal from a social post or a relative date", () => {
    const acts = corporateActions([
      { text: "Limbach acquires Pioneer Power and 1901 Group", url: "https://www.facebook.com/TampaBusinessJournal/posts/1", date: "1 month ago" },
      { text: "MJW Investments acquires Coventry Square Apartments", url: "https://news.example/a", date: "4 years ago" },
    ], ["Limbach Holdings", "MJW Investments"]);
    assert.deepEqual(acts.map((a) => [a.name, a.date]), [["Coventry Square Apartments", undefined]]);
    assert.equal(dealDate("Feb 4, 2025"), "Feb 4, 2025");
  });

  it("carries dockets and, when few, peers; never a social deal", () => {
    const bundle = bundleOf({ company: { name: "Graybar" }, competitors: [{ name: "Wesco", url: "https://a.example" }] });
    carryForward(bundle, [{
      courtCases: [{ caption: "Graybar Electric Co.", url: "https://www.nlrb.gov/case/07-CA-053073", docketNumber: "07-CA-053073" },
        { caption: "Patagonia Sues Trump", url: "https://nytimes.com/x", court: "Reported in the news" }],
      competitors: [{ name: "Rexel", url: "https://b.example" }, { name: "Sonepar", url: "https://www.facebook.com/x" }],
      corporateActions: [{ kind: "Acquisition", name: "Atlanta", date: "4 years ago", url: "https://www.facebook.com/groups/1/posts/2/" }],
    }], "graybar.com");
    assert.deepEqual(bundle.courtCases?.map((c) => c.docketNumber), ["07-CA-053073"]);
    assert.deepEqual(bundle.competitors.map((c) => c.name), ["Wesco", "Rexel"]);
    assert.equal(bundle.corporateActions, undefined);
  });

  it("a change at the top is kept even when the model already gave more than the cap (Crumbl)", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"].map((x) => `Risk ${x} closed down`);
    const out = mergeRuleRisks(seven, {}, [{ text: "Leadership transition: Crumbl founders step down", urls: ["https://qz.com/x"], key: "leadership" }]);
    assert.equal(out.risks.length, 8);
  });
});
