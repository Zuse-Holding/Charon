import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { insiderSelling, saleValue } from "./insiders.js";
import { addDevelopments, aboutCompany, findGaps, hasCurrentChief, gapQueries, isTotalRaised, mergeGaps, needsFunding, snippetStates, type GapExtraction, type GapSnippet } from "./gap-fill.js";
import { aboutNamesake, isFillerOpportunity, isNonRisk, isSaleRisk, isTabloidRisk, mergeRuleOpportunities, mergeRuleRisks, ruleOpportunities, ruleRisks } from "./risk-rules.js";
import { contractCeilings } from "./contract-ceilings.js";
import { ownershipFrom, sameRecordOnce } from "../agents/orchestrator/index.js";
import { isValuation } from "./gap-fill.js";
import { applyProfile, profileFrom, suspiciousFounded } from "./profile-cache.js";
import { applyCompanyConsistency } from "./consistency.js";
import { foundedLabel } from "../agents/report-agent/index.js";
import { composeSummary, whatItDoes } from "./summary.js";
import type { Form4Entry, ResearchBundle } from "../types/research.js";

const base = (over: Partial<ResearchBundle> = {}): ResearchBundle => ({
  query: "x", generatedAt: "", company: { name: "Acme Robotics", website: "https://acme.com" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
  ...over,
} as ResearchBundle);

describe("round 10: insider sale values", () => {
  // Limbach's filings gave per-share prices; the risk read "sold about $0K".
  const limbach: Form4Entry[] = [
    { filerName: "Jayme L. Brooks", relationship: "Chief Financial Officer", transactionType: "Sell", shares: "5,703", value: "$85.4269 per share", date: "April 13, 2026", filingUrl: "https://www.sec.gov/Archives/edgar/data/1606163/a.xml" },
    { filerName: "Jayme L. Brooks", relationship: "Chief Financial Officer", transactionType: "Sell", shares: "3,366", value: "$85.19 per share", date: "April 8, 2026", filingUrl: "https://www.sec.gov/files/forms-3-4-5.pdf" },
    { filerName: "Jayme L. Brooks", relationship: "Chief Financial Officer", transactionType: "Sell", shares: "841", value: "$85.11 per share", date: "April 9, 2026" },
    { filerName: "Jayme L. Brooks", relationship: "Chief Financial Officer", transactionType: "Sell", shares: "9,910", value: "$77.1047 to $81.4030 per share", date: "March 17, 2026" },
  ];

  it("multiplies a per-share price by the shares, using a range's midpoint", () => {
    assert.equal(Math.round(saleValue(limbach[0])), Math.round(5703 * 85.4269));
    assert.equal(Math.round(saleValue(limbach[3])), Math.round(9910 * ((77.1047 + 81.403) / 2)));
    assert.equal(saleValue({ value: "$412,000" }), 412000);
    assert.equal(saleValue({ value: "$85.19 per share" }), 0);
  });

  it("states the dollar total, never $0K, and cites a filing, not SEC's instructions PDF", () => {
    const [f] = insiderSelling(limbach);
    assert.match(f.text, /Jayme L\. Brooks \(Chief Financial Officer\) sold about \$1\.6M in 4 sales/);
    assert.ok(!f.text.includes("$0K"));
    assert.equal(f.url, "https://www.sec.gov/Archives/edgar/data/1606163/a.xml");
  });

  it("falls back to a share count when no dollar value is usable", () => {
    const [f] = insiderSelling(limbach.map((e) => ({ ...e, value: undefined })));
    assert.match(f.text, /sold 19,820 shares in 4 sales/);
  });
});

describe("round 10: gap-fill pass", () => {
  it("finds the empty fields and builds targeted queries", () => {
    const gaps = findGaps(base());
    assert.deepEqual(gaps, ["basics", "executives", "competitors", "funding", "acquisitions", "products", "ownership", "developments"]);
    const q = gapQueries("Gecko Robotics", ["executives", "funding"]).map((x) => x.query);
    assert.ok(q.includes(`"Gecko Robotics" CEO`));
    assert.ok(q.some((x) => /raises funding round Series/.test(x)));
  });

  it("asks for funding only where venture rounds are possible", () => {
    assert.equal(needsFunding(base({ company: { name: "Graybar", founded: "1869" } })), false);
    assert.equal(needsFunding(base({ company: { name: "Homeboy", entityType: "nonprofit" } })), false);
    assert.equal(needsFunding(base({ company: { name: "Patagonia" }, ownership: "Owned by the Patagonia Purpose Trust and Holdfast Collective" })), false);
    assert.equal(needsFunding(base({ company: { name: "Gecko Robotics", founded: "2013" } })), true);
    // Only an old round on record: look for later ones (round 11, Gecko).
    assert.equal(needsFunding(base({ company: { name: "Gecko Robotics", founded: "2013" }, funding: [{ round: "Series B", amount: "$40 million" }] }), Date.parse("2026-10-23")), true);
    assert.equal(needsFunding(base({ company: { name: "Gecko Robotics", founded: "2013" }, funding: [{ round: "Series D", amount: "$125M", date: "2025" }] }), Date.parse("2026-10-23")), false);
  });

  it("keeps only results that name the company or come from its site", () => {
    assert.ok(aboutCompany({ title: "Gecko Robotics raises $125M Series D", url: "https://techcrunch.com/x" }, ["Gecko Robotics"]));
    assert.ok(aboutCompany({ title: "Leadership", url: "https://www.geckorobotics.com/about" }, ["Gecko Robotics"], "geckorobotics.com"));
    assert.ok(!aboutCompany({ title: "Town of Patagonia council meeting", url: "https://x.com" }, ["Patagonia, Inc."]));
    assert.ok(!aboutCompany({ title: "EF Adventures adds hiking trips to Patagonia", url: "https://x.com" }, ["Patagonia"]));
    assert.ok(aboutCompany({ title: "Patagonia CEO Ryan Gellert on the 2022 ownership change", url: "https://x.com" }, ["Patagonia"]));
  });

  it("checks each value against the result it cites", () => {
    assert.ok(snippetStates("Crumbl was founded in 2017 in Logan, Utah", "2017", "year"));
    assert.ok(!snippetStates("Crumbl opened its 1,000th store", "2017", "year"));
    assert.ok(snippetStates("Crumbl is headquartered in Lindon, Utah", "Lindon, UT", "place"));
    assert.ok(snippetStates("CEO Jake Loosararian said", "Jake Loosararian", "name"));
    assert.ok(snippetStates("raised $125 million in a Series D", "$125M", "money"));
  });

  it("fills only empty fields, only with values its snippet states", () => {
    const bundle = base({ company: { name: "Gecko Robotics", website: "https://geckorobotics.com", founded: "2013" }, competitors: [{ name: "Eddyfi Technologies" }] });
    const snippets: GapSnippet[] = [
      { n: 1, title: "Gecko Robotics", url: "https://a.com", text: "Gecko Robotics, headquartered in Pittsburgh, PA, was founded in 2012." },
      { n: 2, title: "Leadership", url: "https://b.com", text: "Jake Loosararian, co-founder and CEO of Gecko Robotics, said the Navy deal..." },
      { n: 3, title: "Funding", url: "https://c.com", text: "Gecko Robotics raises $125 million Series D at a $1.25B valuation" },
      { n: 4, title: "Competitors", url: "https://d.com", text: "Gecko Robotics competitors include ANYbotics and Avitas" },
      { n: 5, title: "Gecko Robotics vs ANYbotics", url: "https://e.com", text: "Gecko Robotics vs ANYbotics: inspection robots compared" },
    ];
    const x: GapExtraction = {
      founded: { value: "2012", source: 1 },
      headquarters: { value: "Pittsburgh, PA", source: 1 },
      executives: [{ name: "Jake Loosararian", title: "CEO", source: 2 }, { name: "Made Up Person", title: "President", source: 2 }],
      competitors: [{ name: "ANYbotics", source: 4 }, { name: "Gecko Robotics", source: 4 }, { name: "Boston Dynamics", source: 4 }],
      funding: [{ round: "Series D", amount: "$125M", date: "2025", source: 3 }, { round: "Series E", amount: "$900M", date: undefined, source: 3 }],
      products: [],
    };
    const filled = mergeGaps(bundle, x, snippets, ["basics", "executives", "competitors", "funding"], ["Gecko Robotics"]);
    assert.equal(bundle.company.founded, "2013", "a sourced year is never replaced");
    assert.equal(bundle.company.headquarters, "Pittsburgh, PA");
    assert.deepEqual(bundle.leadership.map((l) => `${l.title} ${l.name}`), ["CEO Jake Loosararian"]);
    assert.deepEqual(bundle.competitors.map((c) => c.name), ["Eddyfi Technologies", "ANYbotics"]);
    assert.deepEqual(bundle.funding.map((f) => `${f.round} ${f.amount}`), ["Series D $125M"]);
    assert.ok(filled.includes("headquarters Pittsburgh, PA"));
    assert.ok(bundle.sources.some((s) => s.url === "https://c.com" && s.usedFor.includes("funding")));
  });
});

describe("round 10: executives", () => {
  const now = Date.parse("2026-10-23");
  it("a 2012 article's President or two cofounders don't count as a current chief", () => {
    assert.ok(!hasCurrentChief([{ name: "Kathleen Mazzarella", title: "President", sourceUrl: "https://patch.com/x", asOf: "Mar 10, 2012" }], "graybar.com", now));
    assert.ok(!hasCurrentChief([{ name: "Jake Loosararian", title: "Cofounder", sourceUrl: "https://geckorobotics.com/about" }], "geckorobotics.com", now));
    assert.ok(hasCurrentChief([{ name: "Michael McCann", title: "Chief Executive Officer", sourceUrl: "https://www.limbachinc.com/leadership" }], "limbachinc.com", now));
    assert.ok(!hasCurrentChief([{ name: "Pat Doe", title: "Vice President, Sales", sourceUrl: "https://www.limbachinc.com/x" }], "limbachinc.com", now));
  });

  it("gives a listed cofounder the CEO title, and replaces a stale shorter title", () => {
    const bundle = base({ company: { name: "Graybar Electric Company" }, leadership: [
      { name: "Jake Loosararian", title: "Cofounder" }, { name: "Kathleen Mazzarella", title: "President", sourceUrl: "https://patch.com/x" }] });
    const snippets: GapSnippet[] = [
      { n: 1, title: "x", url: "https://a.com", text: "Jake Loosararian, CEO of Gecko Robotics" },
      { n: 2, title: "y", url: "https://b.com", text: "Kathleen Mazzarella, Chairman, President and CEO of Graybar Electric Company" }];
    mergeGaps(bundle, { executives: [{ name: "Jake Loosararian", title: "CEO", source: 1 }, { name: "Kathleen Mazzarella", title: "Chairman, President and CEO", source: 2 }],
      competitors: [], funding: [] } as unknown as GapExtraction, snippets, ["executives"], ["Graybar Electric Company"]);
    assert.deepEqual(bundle.leadership.map((l) => l.title), ["CEO and Cofounder", "Chairman, President and CEO"]);
    assert.equal(bundle.leadership[1].sourceUrl, "https://b.com");
  });
});

describe("round 10: rule-based risks", () => {
  const now = Date.parse("2026-10-23");
  it("states a 990 squeeze, a closure wave, open suits and a one-buyer ceiling", () => {
    const bundle = base({
      company: { name: "Homeboy Industries" },
      nonprofitFinancials: { url: "https://propublica.org/954800735", years: [
        { year: "2021", revenue: 52.32e6, contributions: 47.01e6, expenses: 22.53e6 },
        { year: "2023", revenue: 47.2e6, contributions: 39.37e6, expenses: 40.05e6 }] } as ResearchBundle["nonprofitFinancials"],
      news: [{ headline: "Homeboy Industries closes two social enterprises", date: "Oct 1, 2026", url: "https://n.com/a" }],
      courtCases: [
        { caption: "Doe v. Homeboy Industries", court: "C.D. Cal.", filed: "2026-01-27", url: "https://cl.com/1", role: "defendant", status: "open" },
        { caption: "Roe v. Homeboy Industries", court: "C.D. Cal.", filed: "2025-08-21", url: "https://cl.com/2", role: "defendant", status: "open" },
        { caption: "Old v. Homeboy Industries", court: "C.D. Cal.", filed: "2019-01-01", url: "https://cl.com/3", role: "defendant", status: "status unverified" },
      ],
      contractCeilings: [{ agency: "Department of Defense", ceiling: 300e6, obligated: 1.57e6, newsUrl: "https://n.com/navy" }] as ResearchBundle["contractCeilings"],
    });
    const risks = ruleRisks(bundle, ["Homeboy Industries"], now);
    const keys = risks.map((r) => r.key);
    assert.deepEqual(keys, ["990", "closure", "open-cases", "concentration"]);
    assert.match(risks[0].text, /Expenses rose 78% from \$22\.5M \(2021\) to \$40\.0M \(2023\) while contributions and grants fell 16%/);
    assert.match(risks[2].text, /^2 open federal cases against the company were filed since 2025/);
  });

  it("adds a rule risk only when no model risk covers it", () => {
    const merged = mergeRuleRisks(["Expenses rose 78% while revenue fell."], { "Expenses rose 78% while revenue fell.": ["https://propublica.org/954800735"] },
      [{ text: "Expenses rose 78% ...", urls: ["https://propublica.org/954800735"], key: "990" }, { text: "2 open federal cases ...", urls: ["https://cl.com/1"], key: "open-cases" }]);
    assert.deepEqual(merged.risks, ["Expenses rose 78% while revenue fell.", "2 open federal cases ..."]);
    assert.deepEqual(merged.citations["2 open federal cases ..."], ["https://cl.com/1"]);
  });

  it("drops tabloid and sale risks, filler and namesake opportunities", () => {
    assert.ok(isTabloidRisk("Co-founder Sawyer Hemsley is in a controversy over a TikToker's claims about a Grindr event."));
    assert.ok(isSaleRisk("Patagonia is selling its Nano Puff jacket for up to 50% off."));
    assert.ok(!isSaleRisk("Crumbl closed 57 locations as sales slowed."));
    assert.ok(isFillerOpportunity("The company's comprehensive offerings indicate a broad market reach."));
    assert.ok(isFillerOpportunity("The promotion of Chuck Darway to President indicates ongoing leadership development and strategic planning within the company."));
    assert.ok(!isFillerOpportunity("ACCO is adding a high-purity piping facility in Arizona."));
    assert.ok(aboutNamesake("EF Adventures is adding new backcountry hiking trips to Patagonia for 2027.", ["Patagonia"]));
  });
});

describe("round 10: saved company profile", () => {
  it("flags a founding year after the domain's registration", () => {
    assert.ok(suspiciousFounded(base({ company: { name: "Limbach", founded: "2019" }, domainPosture: { registeredAt: "1996-11-22" } as ResearchBundle["domainPosture"] })));
    assert.ok(!suspiciousFounded(base({ company: { name: "Gecko", founded: "2013" }, domainPosture: { registeredAt: "2013-03-11" } as ResearchBundle["domainPosture"] })));
    assert.ok(!suspiciousFounded(base({ company: { name: "Limbach", founded: "2019", foundedSource: "https://www.sec.gov/x" }, domainPosture: { registeredAt: "1996-11-22" } as ResearchBundle["domainPosture"] })));
  });

  it("reuses saved basics, never over a filed year, and saves only sourced values", () => {
    const saved = { domain: "limbachinc.com", founded: "1901", founded_source: "https://limbachinc.com/about", ownership: "Employee-owned (ESOP)", ownership_source: "https://x.com/esop" };
    const b = base({ company: { name: "Limbach", founded: "1900" } });
    assert.deepEqual(applyProfile(b, saved), ["founded 1901", "ownership Employee-owned (ESOP)"]);
    assert.equal(b.company.founded, "1901");
    const filed = base({ company: { name: "Graybar", founded: "1869", foundedSource: "https://www.sec.gov/10k" } });
    applyProfile(filed, { domain: "graybar.com", founded: "1864", founded_source: "https://graybar.com" });
    assert.equal(filed.company.founded, "1869");
    const rec = profileFrom(base({ company: { name: "ACCO", website: "https://accoes.com", founded: "1934", headquarters: "Pasadena, CA" } }), "accoes.com");
    assert.equal(rec?.founded, "1934");
    assert.equal(rec?.founded_source, "https://accoes.com");
    assert.equal(rec?.headquarters, "Pasadena, CA");
  });
});

describe("round 11: Gecko canary", () => {
  it("doesn't repeat cofounder in an upgraded title", () => {
    const bundle = base({ leadership: [{ name: "Jake Loosararian", title: "Cofounder", sourceUrl: "https://geckorobotics.com/about" }] });
    mergeGaps(bundle, { executives: [{ name: "Jake Loosararian", title: "Co-Founder and CEO", source: 1 }], competitors: [], funding: [] } as unknown as GapExtraction,
      [{ n: 1, title: "x", url: "https://linkedin.com/in/jake", text: "Jake Loosararian - Co-Founder and CEO - Gecko Robotics" }], ["executives"], ["Gecko Robotics"]);
    assert.equal(bundle.leadership[0].title, "Co-Founder and CEO");
  });

  it("keeps a verified late round for a company matched on its website", () => {
    const bundle = base({ company: { name: "Gecko Robotics", website: "https://geckorobotics.com", anchor: { website: "https://geckorobotics.com" } },
      funding: [{ round: "Series D", amount: "$125 million", date: "2025", verified: true }, { round: "Series E", amount: "$900 million" }] });
    applyCompanyConsistency(bundle, { name: "Gecko Robotics", anchor: { website: "https://geckorobotics.com" }, domain: "geckorobotics.com" });
    assert.deepEqual(bundle.funding.map((f) => f.round), ["Series D"]);
    const big = base({ company: { name: "Gecko Robotics", anchor: { website: "https://geckorobotics.com" } },
      funding: [{ round: "Series E", amount: "$900 million" }], contractCeilings: [{ agency: "DoD", ceiling: 300e6, obligated: 1.6e6 }] as ResearchBundle["contractCeilings"] });
    applyCompanyConsistency(big, { name: "Gecko Robotics", anchor: { website: "https://geckorobotics.com" }, domain: "geckorobotics.com" });
    assert.equal(big.funding.length, 1);
  });
});

describe("round 11: funding sanity", () => {
  it("drops a nine-figure seed round and a total raised read as a round", () => {
    const bundle = base({ company: { name: "Gecko Robotics" }, funding: [{ round: "Seed", amount: "$354M" }, { round: "Series D", amount: "$125 million", verified: true }] });
    applyCompanyConsistency(bundle, { name: "Gecko Robotics", anchor: {}, domain: "geckorobotics.com" });
    assert.deepEqual(bundle.funding.map((f) => f.round), ["Series D"]);
    const b2 = base({ company: { name: "Gecko Robotics", founded: "2013" } });
    mergeGaps(b2, { funding: [{ round: "Series C", amount: "$354M", source: 1 }], executives: [], competitors: [] } as unknown as GapExtraction,
      [{ n: 1, title: "x", url: "https://a.com", text: "Gecko Robotics has raised $354M to date across its funding rounds." }], ["funding"], ["Gecko Robotics"]);
    assert.equal(b2.funding.length, 0);
  });

  it("keeps a round whose headline also gives the running total", () => {
    assert.equal(isTotalRaised("Gecko Robotics raises $125M Series D, bringing total raised to $347M", "$125M"), false);
    assert.equal(isTotalRaised("Gecko Robotics raises $125M Series D, bringing total raised to $347M", "$347M"), true);
    assert.equal(isTotalRaised("Gecko Robotics raised $125 million in a Series D round, bringing its total funding to $347 million.", "$125 million"), false);
    assert.equal(isTotalRaised("In total, Gecko Robotics has raised $354 million.", "$354 million"), true);
    assert.equal(isTotalRaised("Gecko Robotics has raised $354M to date from investors including Founders Fund.", "$354M"), true);
    const b = base({ company: { name: "Gecko Robotics" }, funding: [] });
    mergeGaps(b, { funding: [{ round: "Series D", amount: "$125M", date: "2025", source: 1 }], executives: [], competitors: [] } as unknown as GapExtraction,
      [{ n: 1, title: "x", url: "https://a.com", text: "Gecko Robotics raises $125M Series D, bringing total raised to $347M" }], ["funding"], ["Gecko Robotics"]);
    assert.deepEqual(b.funding.map((f) => f.round), ["Series D"]);
  });
});

describe("round 11: full run fixes", () => {
  it("adds a competitor only when two results name it or one compares directly", () => {
    const bundle = base({ company: { name: "MJW Investments" } });
    const snippets: GapSnippet[] = [
      { n: 1, title: "x", url: "https://a.com", text: "MJW Investments top competitors: KKR, The Carlyle Group, Henan Zhongyuan Expressway" },
      { n: 2, title: "y", url: "https://b.com", text: "MJW Investments competitors include Greystar and CA Ventures" },
      { n: 3, title: "z", url: "https://c.com", text: "Student housing operators such as Greystar and Landmark Properties" },
      { n: 4, title: "w", url: "https://d.com", text: "Homeboy alternatives: lakeforest, Community" },
    ];
    mergeGaps(bundle, { competitors: [{ name: "KKR", source: 1 }, { name: "Greystar", source: 2 }, { name: "CA Ventures", source: 2 }, { name: "lakeforest", source: 4 }, { name: "Community", source: 4 }],
      executives: [], funding: [] } as unknown as GapExtraction, snippets, ["competitors"], ["MJW Investments"]);
    // Greystar is named by two results; CA Ventures and KKR by one listing each.
    assert.deepEqual(bundle.competitors.map((c) => c.name), ["Greystar"]);
  });

  it("never turns a 2013 release about a town into an enforcement risk", () => {
    const bundle = base({ company: { name: "Patagonia" }, courtCases: [
      { caption: "Four Patagonia Drug Traffickers Sentenced To Serve A ...", court: "U.S. Department of Justice", filed: "Jul 2, 2013", url: "https://justice.gov/usao-az/x", role: "charged", caseType: "Government enforcement" },
      { caption: "United States v. ACCO Engineered Systems, Inc.", court: "U.S. Department of Justice", filed: "Jul 25, 2026", url: "https://justice.gov/eoir/x", role: "charged", caseType: "Government enforcement" }] });
    const keys = ruleRisks(bundle, ["Patagonia"], Date.parse("2026-10-23")).filter((r) => r.key === "enforcement");
    assert.equal(keys.length, 0);
    const acco = ruleRisks({ ...bundle, company: { name: "ACCO Engineered Systems" } } as ResearchBundle, ["ACCO Engineered Systems"], Date.parse("2026-10-23")).filter((r) => r.key === "enforcement");
    assert.equal(acco.length, 1);
  });

  it("drops non-risks, savings items and community-event opportunities", () => {
    assert.ok(isNonRisk("The acquisition of Coventry Square Apartments on March 2, 2025, is the most recent property acquisition mentioned."));
    assert.ok(!isNonRisk("Graybar is currently a defendant in three open cases."));
    assert.ok(isSaleRisk("Patagonia is offering rare savings on its Nano Puff jacket."));
    assert.ok(isFillerOpportunity("The organization continues to engage the community through its annual 5K event, which brought thousands together."));
  });

  it("labels where a founding year came from", () => {
    assert.equal(foundedLabel("https://www.linkedin.com/company/patagonia_2"), "source");
    assert.equal(foundedLabel("https://bizfileonline.sos.ca.gov/x"), "state record");
    assert.equal(foundedLabel("https://www.sec.gov/Archives/x"), "10-K");
  });
});

describe("round 12: more gaps and a factual summary", () => {
  it("adds recent company events from the targeted search as news", () => {
    const bundle = base({ company: { name: "Crumbl" } });
    const added = addDevelopments(bundle, [
      { n: 1, title: "Crumbl co-founder Jason McGowan steps down as CEO", url: "https://a.com/x", text: "Crumbl co-founder Jason McGowan steps down as CEO. In May 2026...", date: "May 12, 2026" },
      { n: 2, title: "Crumbl announces minority investment from TSG Consumer Partners", url: "https://b.com/y", text: "Crumbl announces minority investment from TSG Consumer Partners", date: "Feb 2, 2025" },
      { n: 3, title: "Crumbl opened in 2017", url: "https://c.com/z", text: "Crumbl opened its first store in Logan in 2017", date: "Jan 1, 2019" },
      { n: 4, title: "Crumbl cookies 50% off this week", url: "https://d.com/w", text: "deal", date: "Oct 20, 2026" },
    ], Date.parse("2026-10-23"));
    assert.deepEqual(added, ["Crumbl co-founder Jason McGowan steps down as CEO", "Crumbl announces minority investment from TSG Consumer Partners"]);
    assert.equal(bundle.news.length, 2);
  });

  it("asks for products, ownership and recent events", () => {
    const q = gapQueries("ACCO Engineered Systems", ["products", "ownership", "developments"]).map((x) => x.query);
    assert.ok(q.some((x) => /products platform/.test(x)));
    assert.ok(q.some((x) => /ESOP/.test(x)));
    assert.ok(q.some((x) => /steps down/.test(x)));
  });

  it("writes a summary from the facts when the model's didn't survive", () => {
    const bundle = base({ company: { name: "Gecko Robotics", description: "Provides AI and robotic tools to monitor critical infrastructure.", founded: "2013", headquarters: "Pittsburgh, PA" },
      leadership: [{ name: "Jake Loosararian", title: "Co-Founder and CEO" }, { name: "Troy Demmer", title: "Cofounder" }],
      funding: [{ round: "Series D", amount: "$125M", date: "2025" }, { round: "Series C", amount: "$173M" }],
      news: [{ headline: "Gecko Robotics secures $300M contract with the U.S. Navy", date: "Oct 20, 2026", url: "https://x.com" }] });
    const s = composeSummary(bundle, Date.parse("2026-10-23"))!;
    assert.match(s, /^Gecko Robotics provides AI and robotic tools/);
    assert.match(s, /Founded in 2013 and based in Pittsburgh, PA\./);
    assert.match(s, /Led by Jake Loosararian \(Co-Founder and CEO\)\./);
    assert.match(s, /Series D \(\$125M, 2025\)/);
    assert.match(s, /Most recent coverage: "Gecko Robotics secures \$300M contract with the U\.S\. Navy" \(Oct 20, 2026\)\./);
    assert.equal(whatItDoes("MJW Investments", "A real estate investment firm."), "MJW Investments is a real estate investment firm.");
  });
});

describe("round 12b: the Gecko canary", () => {
  const now = Date.parse("2026-10-23");
  const awards = [
    { amount: "$3,427,919", awardingAgency: "General Services Administration", date: "2026-01-30", description: "GECKO ROBOTICS CNSP TO 01" },
    { amount: "$1,494,360", awardingAgency: "Department of Defense", date: "2022-09-15", description: "SBIR PHASE II" },
    { amount: "$72,216", awardingAgency: "Department of Defense", date: "2023-12-12", description: "ROBOTIC DATA ACQUISITION" },
  ] as any[];
  const news = [
    { headline: "U.S. Navy Awards $300M Contract to Robotic-Inspection Startup Gecko", url: "https://maritime-executive.com/x", date: "Oct 22, 2026" },
    { headline: "Gecko Robotics to open manufacturing facility in Sewickley", url: "https://axios.com/y", date: "Jul 16, 2026", outlet: "axios.com" },
  ] as any[];

  it("counts a Navy contract against Department of Defense awards", () => {
    const k = contractCeilings(awards, news);
    assert.equal(k.length, 1);
    assert.equal(k[0].ceiling, 300e6);
    assert.equal(k[0].obligated, 1_494_360 + 72_216);
  });

  it("states the open ceiling and the new plant as opportunities", () => {
    const bundle = base({ company: { name: "Gecko Robotics" }, news, federalSpending: awards });
    bundle.contractCeilings = contractCeilings(awards, news);
    const rules = ruleOpportunities(bundle, ["Gecko Robotics"], now);
    assert.deepEqual(rules.map((r) => r.key), ["ceiling", "expansion"]);
    assert.match(rules[0].text, /\$300\.0M against about \$1\.6M obligated/);
    assert.match(rules[1].text, /Sewickley \(axios\.com, Jul 16, 2026\)/);
    const merged = mergeRuleOpportunities([], {}, rules);
    assert.equal(merged.opportunities.length, 2);
    // A model opportunity already on the ceiling keeps the rule out.
    assert.equal(mergeRuleOpportunities(["The $300M ceiling leaves room for task orders."], {}, rules).opportunities.length, 2);
  });

  it("never reads a funding round or the company itself as its owner", () => {
    const url = "https://x.com";
    assert.equal(ownershipFrom([{ text: "backed and owned by Series Gecko Robotics and others", url }], ["Gecko Robotics"]), undefined);
    assert.equal(ownershipFrom([{ text: "Gecko is owned by Gecko Robotics, Inc.", url }], ["Gecko Robotics"]), undefined);
    assert.deepEqual(ownershipFrom([{ text: "ACCO is 100% employee-owned.", url }], ["ACCO"]), { note: "Employee-owned", url });
    assert.deepEqual(ownershipFrom([{ text: "Graybar is owned by its employees and retirees", url }], ["Graybar"]), { note: "Employee-owned", url });
  });

  it("skips the ownership search for a venture-backed company", () => {
    const bundle = base({ company: { name: "Gecko Robotics" }, funding: [{ round: "Series B", amount: "$40M" }] });
    assert.ok(!findGaps(bundle).includes("ownership"));
  });
});

describe("round 12c: Gecko canary, second run", () => {
  it("never takes a valuation for the round's size", () => {
    const t = "Gecko Robotics raises $125M Series D at a $1.25B valuation, becoming a unicorn.";
    assert.equal(isValuation(t, "$1.25B"), true);
    assert.equal(isValuation(t, "$125M"), false);
    assert.equal(isValuation("Gecko is now valued at $1.25 billion after its Series D.", "$1.25B"), true);
    assert.equal(isValuation("Crumbl closed a $1B funding round.", "$1B"), false);
  });

  it("shows one announced ceiling once, whichever articles carried it", () => {
    const awards = [{ amount: "$1,494,360", awardingAgency: "Department of Defense" }, { amount: "$72,216", awardingAgency: "Department of Defense" }] as any[];
    const news = [
      { headline: "U.S. Navy Awards $300M Contract to Robotic-Inspection Startup Gecko", url: "https://maritime-executive.com/x" },
      { headline: "Gecko Robotics secures $300M contract with the U.S. Navy and Department of Defense", url: "https://therobotreport.com/y" },
    ] as any[];
    const k = contractCeilings(awards, news);
    assert.equal(k.length, 1);
    assert.equal(k[0].agency, "Navy / Department of Defense");
  });

  it("keeps one opportunity per record and figure", () => {
    const a = "Opportunity to secure more work under its $300 million IDIQ contract with only $1.57 million obligated.";
    const b = "Opportunity to expand DoD work under a $300M ceiling contract.";
    const c = "Further growth in US naval work after the expanded contract.";
    const cites = { [a]: ["https://maritime.com", "https://usaspending.gov"], [b]: ["https://usaspending.gov"], [c]: ["https://janes.com"] };
    assert.deepEqual(sameRecordOnce([c, a, b], cites), [c, a]);
  });
});
