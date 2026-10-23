import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cikFromSearch, cikFromTickers, latestEarnings8K, latestQuarter, pressReleaseFile } from "../agents/sec-filings-agent/index.js";
import { nonprofitYears, subjectOrganization } from "../agents/propublica-nonprofit-agent/index.js";
import { entityTypeOf } from "./entity-type.js";
import { applyEntityType } from "../agents/orchestrator/index.js";
import { cleanLeadership, resolveFounderClaims, resolveTitleConflicts, titleNear } from "./leadership.js";
import { brandName, NewsAgent } from "../agents/news-agent/index.js";
import { isFieldPhrase, isPeer } from "../agents/competitor-agent/index.js";
import { affiliatedDomains, evaluatePosture } from "../agents/domain-posture-agent/index.js";
import { plausibleAnalysis } from "./consistency.js";
import { lockedFacts } from "../agents/synthesis-agent/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";
import type { SearchProvider } from "./providers.js";

const bundleOf = (over: Partial<ResearchBundle> = {}): ResearchBundle => ({
  query: "x", generatedAt: "2026-10-22", company: { name: "Homeboy Industries", website: "https://homeboyindustries.org" },
  leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
});

describe("round five: SEC filings (fix 33)", () => {
  it("matches a filer whose display name carries a ticker", () => {
    const hits = [{ _source: { ciks: ["0001606163"], display_names: ["Limbach Holdings, Inc.  (LMB)  (CIK 0001606163)"] } }];
    assert.equal(cikFromSearch(hits, "Limbach Holdings"), "0001606163");
  });

  it("falls back to the ticker list by name, suffixes off", () => {
    const rows = [{ cik_str: 1, title: "LIMBACH HOLDINGS, INC." }, { cik_str: 2, title: "Limbach Foods Corp" }];
    assert.equal(cikFromTickers(rows, "Limbach"), "1");
    assert.equal(cikFromTickers(rows, "Limbach Holdings, Inc."), "1");
    assert.equal(cikFromTickers(rows, "Nobody Corp"), undefined);
  });

  it("compares the newest quarter with the same quarter a year earlier", () => {
    const q = (start: string, end: string, val: number, fp: string, fy: number) => ({ start, end, val, fp, fy, form: "10-Q", filed: end });
    const facts = { facts: { "us-gaap": {
      Revenues: { units: { USD: [q("2025-04-01", "2025-06-30", 142e6, "Q2", 2025), q("2026-04-01", "2026-06-30", 160e6, "Q2", 2026)] } },
      GrossProfit: { units: { USD: [q("2025-04-01", "2025-06-30", 39.76e6, "Q2", 2025), q("2026-04-01", "2026-06-30", 34.4e6, "Q2", 2026)] } },
    } } };
    const r = latestQuarter(facts)!;
    assert.equal(r.label, "Q2 2026");
    assert.equal(r.priorRevenue, 142e6);
    assert.equal(r.grossMargin!.toFixed(3), "0.215");
    assert.equal(r.priorGrossMargin!.toFixed(3), "0.280");
  });

  it("finds the latest results 8-K and its press release exhibit", () => {
    const sub = { filings: { recent: { form: ["8-K", "10-Q", "8-K"], accessionNumber: ["0001-26-000009", "0001-26-000008", "0001-26-000007"],
      filingDate: ["2026-09-01", "2026-08-06", "2026-08-05"], items: ["5.02", "", "2.02,9.01"] } } };
    assert.deepEqual(latestEarnings8K(sub, "0001606163"), { folder: "https://www.sec.gov/Archives/edgar/data/1606163/000126000007", date: "2026-08-05" });
    assert.equal(pressReleaseFile([{ name: "lmb-20260805.htm" }, { name: "lmb-ex99_1.htm" }, { name: "R1.htm" }]), "lmb-ex99_1.htm");
  });
});

describe("round five: nonprofits and entity type (fixes 33, 34)", () => {
  it("reads 990 years newest first", () => {
    const years = nonprofitYears([
      { tax_prd_yr: 2023, formtype: 0, totrevenue: 40e6 },
      { tax_prd_yr: 2024, formtype: 0, totrevenue: 46.95e6, totfuncexpns: 41.68e6, totassetsend: 110.04e6, totcntrbgfts: 30e6, pdf_url: "https://x/990.pdf" },
    ]);
    assert.equal(years[0].year, "2024");
    assert.equal(years[0].formType, "990");
    assert.equal(years[0].assets, 110.04e6);
  });

  it("picks the organization named like the company, in its state", () => {
    const orgs = [
      { ein: "1", name: "Homeboy Industries Foundation", state: "TX", url: "u1" },
      { ein: "954800735", name: "HOMEBOY INDUSTRIES", state: "CA", url: "u2" },
    ];
    assert.equal(subjectOrganization(orgs, "Homeboy Industries", "CA")?.ein, "954800735");
  });

  it("classifies before Funding is filled", () => {
    const company = { website: "https://homeboyindustries.org", description: "The largest gang rehabilitation and reentry program; donate today." };
    assert.equal(entityTypeOf({ company, funding: [{ round: "Series B", amount: "$76M" }] }), "nonprofit");
    assert.equal(entityTypeOf({ company: { website: "https://gecko.com" }, funding: [{ round: "Series D", amount: "$125M" }] }), "venture");
    assert.equal(entityTypeOf({ company: { website: "https://acme.com" }, funding: [] }), "private");
  });

  it("a nonprofit never shows rounds; its 990 is the Funding section", () => {
    const np = { ein: "954800735", name: "Homeboy Industries", url: "https://projects.propublica.org/nonprofits/organizations/954800735",
      years: [{ year: "2024", formType: "990", revenue: 46.95e6, expenses: 41.68e6, assets: 110.04e6 }] };
    const b = bundleOf({
      funding: [{ round: "Series B", amount: "$76M" }],
      nonprofitFinancials: np,
      sources: [{ url: "https://other.example/series-b", title: "x", retrievedAt: "", usedFor: ["funding"] }, { url: np.url, title: "990", retrievedAt: "", usedFor: ["nonprofit"] }],
    });
    applyEntityType(b, false);
    assert.equal(b.company.entityType, "nonprofit");
    assert.deepEqual(b.funding, []);
    assert.ok(!b.sources.some((s) => s.url.includes("series-b")));
    const report = new ReportAgent().generate(b);
    const funding = report.slice(report.indexOf("## Funding"), report.indexOf("##", report.indexOf("## Funding") + 3));
    assert.match(funding, /2024 Form 990:.*total revenue \$46\.95M · expenses \$41\.68M · assets \$110\.04M/);
    assert.doesNotMatch(funding, /Series B/);
  });

  it("a nonprofit's analysis may talk about its campaign, never investors", () => {
    const b = bundleOf({ company: { name: "Homeboy Industries", entityType: "nonprofit" }, nonprofitFinancials: { ein: "1", name: "x", url: "u", years: [{ year: "2024", revenue: 46.95e6 }] } });
    const kept = plausibleAnalysis(["Its fundraising leans on donors.", "Investors may push for a sale."], b);
    assert.deepEqual(kept, ["Its fundraising leans on donors."]);
  });
});

describe("round five: leadership (fixes 35, 37)", () => {
  it("a former CEO with no other title drops off the list", () => {
    const out = resolveTitleConflicts([
      { name: "Charlie Bacon", title: "CEO", sourceUrl: "https://limbachinc.com/about" },
      { name: "Michael McCann", title: "President and CEO", sourceUrl: "https://www.sec.gov/x", asOf: "2026-03-01" },
    ], "limbachinc.com");
    assert.deepEqual(out.map((l) => l.name), ["Michael McCann"]);
  });

  it("co-CEOs share the seat; a sole CEO from a weaker source loses it", () => {
    const out = resolveTitleConflicts([
      { name: "Shirley Torres", title: "Co-CEO", sourceUrl: "https://homeboyindustries.org/team", asOf: "2026-06-01" },
      { name: "Steve Delgado", title: "Co-CEO", sourceUrl: "https://homeboyindustries.org/team", asOf: "2026-06-01" },
      { name: "Martin Cabrera Jr.", title: "CEO", sourceUrl: "https://someblog.example/post" },
    ], "homeboyindustries.org");
    assert.deepEqual(out.map((l) => l.name), ["Shirley Torres", "Steve Delgado"]);
  });

  it("a second sole founder from a weaker source is disputed", () => {
    const out = resolveFounderClaims([
      { name: "Gregory Boyle", title: "Founder", sourceUrl: "https://homeboyindustries.org/about" },
      { name: "Martin Cabrera Jr.", title: "CEO and Founder", sourceUrl: "https://someblog.example/post" },
    ], "homeboyindustries.org");
    const cabrera = out.find((l) => l.name.startsWith("Martin"))!;
    assert.equal(cabrera.title, "CEO");
    assert.deepEqual(cabrera.disputedTitles, ["Founder"]);
    // Co-founders aren't a conflict.
    const cofounders = cleanLeadership([{ name: "A B", title: "Co-founder" }, { name: "C D", title: "Co-founder" }]);
    assert.equal(cofounders.length, 2);
  });

  it("reads a co-CEO title off the page", () => {
    assert.equal(titleNear("Steve Delgado", ["Steve Delgado, co-CEO of Homeboy Industries"]), "Co-CEO");
  });

  it("synthesis facts leave out directory-only names", () => {
    const facts = lockedFacts(bundleOf({ leadership: [{ name: "X Y", title: "CFO", lowConfidence: true, sourceUrl: "https://rocketreach.co/x" }] }));
    assert.ok(!facts.some((f) => f.text.includes("X Y")));
  });
});

describe("round five: news (fix 36)", () => {
  it("knows the short name the press uses", () => {
    assert.equal(brandName("Graybar Electric Company", "graybar.com"), "Graybar");
    assert.equal(brandName("Crumbl Cookies", "crumblcookies.com"), "Crumbl");
    assert.equal(brandName("Graybar", "graybar.com"), undefined);
    assert.equal(brandName("ACCO Engineered Systems", "accoes.com"), undefined);
  });

  it("searches the news index and keeps headlines that use the short name", async () => {
    const queries: string[] = [];
    const searcher: SearchProvider = {
      search: async (q) => { queries.push(`web:${q}`); return []; },
      news: async (q) => {
        queries.push(`news:${q}`);
        return [{ title: "Graybar names new president in leadership change", url: "https://www.stltoday.com/business/graybar-president", snippet: "Graybar said Tuesday...", date: "Apr 14, 2026" }];
      },
    };
    const fetcher = { fetchText: async () => null };
    const r = await new NewsAgent(fetcher, searcher).run("Graybar Electric Company", {}, "graybar.com", { aliases: ["Graybar"], profileTerms: ["electrical"] });
    assert.equal(r.news.length, 1);
    assert.ok(queries.some((q) => q.startsWith('news:"Graybar"')));
  });

  it("a located search that finds nothing is tried without the city", async () => {
    const queries: string[] = [];
    const searcher: SearchProvider = {
      search: async (q) => { queries.push(q); return []; },
      news: async (q) => {
        queries.push(q);
        return q.includes("Los Angeles") ? [] : [{ title: "Homeboy Industries launches $100M campaign", url: "https://www.latimes.com/a", snippet: "", date: "Jun 3, 2026" }];
      },
    };
    const r = await new NewsAgent({ fetchText: async () => null }, searcher).run("Homeboy Industries", { location: "Los Angeles, CA" }, "homeboyindustries.org");
    assert.equal(r.news.length, 1);
  });
});

describe("round five: competitors (fix 38)", () => {
  it("drops names that only describe the field", () => {
    const profile = { role: "building systems solutions firm", industry: "Mechanical, electrical and plumbing contracting" };
    assert.equal(isFieldPhrase("Building System Solutions LLC", profile), true);
    assert.equal(isFieldPhrase("Building Systems & Services", profile), true);
    assert.equal(isFieldPhrase("Comfort Systems USA", profile), false);
    assert.equal(isFieldPhrase("EMCOR Group", profile), false);
  });

  it("keeps peers only, not funders or partners", () => {
    assert.equal(isPeer({ name: "Kaiser Foundation" }, "Homeboy Industries"), false);
    assert.equal(isPeer({ name: "Defy Ventures", relationship: "peer" }, "Homeboy Industries"), true);
    assert.equal(isPeer({ name: "LA County", relationship: "customer" }, "Homeboy Industries"), false);
  });
});

describe("round five: mail records (fix 39)", () => {
  it("names other companies' domains in MX", () => {
    assert.deepEqual(affiliatedDomains("limbachinc.com", ["0 harperbuildingsystems-com.mail.protection.outlook.com."]), ["harperbuildingsystems.com"]);
    assert.deepEqual(affiliatedDomains("limbachinc.com", ["0 limbachinc-com.mail.protection.outlook.com."]), []);
    assert.deepEqual(affiliatedDomains("acme.com", ["10 mx1.parentco.com.", "20 aspmx.l.google.com.", "5 mx.acme.com."]), ["parentco.com"]);
    assert.deepEqual(affiliatedDomains("acme.com", ["10 mx0a-001.pphosted.com."]), []);
  });

  it("shows them as an info row on the posture card", () => {
    const p = evaluatePosture({ domain: "limbachinc.com", mx: ["0 harperbuildingsystems-com.mail.protection.outlook.com."], txt: [], dmarc: [] });
    assert.match(p.checks.find((c) => c.id === "affiliates")!.detail, /harperbuildingsystems\.com: possibly an acquired/);
  });
});
