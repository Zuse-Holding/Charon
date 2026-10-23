import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { strongNameMatch } from "./name-match.js";
import { isSanctionsHit } from "../agents/sanctions-agent/index.js";
import { pageYears, subjectOrganization } from "../agents/propublica-nonprofit-agent/index.js";
import { cikFromBrowse, tenKExcerpts } from "../agents/sec-filings-agent/index.js";
import { CompetitorAgent } from "../agents/competitor-agent/index.js";
import { newsAboutSubject } from "./entities/subject.js";
import { isLawFirmSolicitation, isPersonalLifeNews } from "./news-noise.js";
import { appointmentsFromNews, applyAppointments, checkFoundersAgainst, cleanLeadership, foundedBy, resolveTitleConflicts, samePerson, tidyTitle } from "./leadership.js";
import { budgetShares, pageBody } from "../agents/website-agent/index.js";
import { contractCeilings } from "./contract-ceilings.js";
import { caseClusters, contradictsCases, isHistoryOnly, trendLine, type Fact } from "../agents/synthesis-agent/index.js";
import { fundTargets, PublicFilingsAgent } from "../agents/public-filings-agent/index.js";
import { evaluatePosture } from "../agents/domain-posture-agent/index.js";
import { CourtListenerAgent } from "../agents/courtlistener-agent/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";
import type { CaseRecord } from "../agents/public-filings-agent/index.js";

const withFetch = async (impl: (url: string) => Response | Promise<Response>, fn: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => impl(String(input))) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = original; }
};

describe("round six: registry matching (fix 40, stop-ship)", () => {
  it("a shared generic word is not a match", () => {
    assert.equal(strongNameMatch("Iran Investment Company", "MJW Investments"), false);
    assert.equal(strongNameMatch("MJW Investments, LLC", "MJW Investments"), true);
    assert.equal(strongNameMatch("Crumbs From Christ", "Crumbl"), false);
    assert.equal(strongNameMatch("Crumb Memorial Foundation", "Crumbl"), false);
    assert.equal(strongNameMatch("HOMEBOY INDUSTRIES", "Homeboy Industries"), true);
  });

  it("a sanctions entry needs the name and an address in the subject's country", () => {
    assert.equal(isSanctionsHit({ name: "Behshahr Industrial Investment Co", addresses: [{ country: "IR" }] }, "MJW Investments"), false);
    assert.equal(isSanctionsHit({ name: "MJW Investments", addresses: [{ country: "RU" }] }, "MJW Investments"), false);
    assert.equal(isSanctionsHit({ name: "MJW Investments", addresses: [] }, "MJW Investments"), false);
    assert.equal(isSanctionsHit({ name: "Other Name", alt_names: ["MJW Investments LLC"], addresses: [{ country: "US" }] }, "MJW Investments"), true);
  });

  it("the report says No matches and never lists similar names", () => {
    const b = { sanctionsScreened: true, sanctionsRuledOut: 7, sanctionsMatches: undefined, sanctionsUnavailable: undefined,
      webArchive: undefined, nonprofitFilings: undefined, powerMapConnections: undefined } as Partial<ResearchBundle>;
    const lines: string[] = [];
    (new ReportAgent() as unknown as { pushPublicRecordsSection(l: string[], b: unknown): void }).pushPublicRecordsSection(lines, b);
    const out = lines.join("\n");
    assert.match(out, /No matches on the Consolidated Screening List/);
    assert.match(out, /7 similar names on the lists were checked and ruled out/);
  });

  it("ProPublica shows only the organization itself", () => {
    const orgs = [
      { ein: "1", name: "Crumbs From Christ", state: "UT", url: "u1" },
      { ein: "2", name: "Crumb Memorial Foundation", state: "UT", url: "u2" },
    ];
    assert.equal(subjectOrganization(orgs, "Crumbl", "UT"), undefined);
  });
});

describe("round six: SEC (fixes 41, 42)", () => {
  it("finds the CIK in EDGAR's company search", () => {
    const atom = `<feed><company-info><cik>0000205402</cik><conformed-name>GRAYBAR ELECTRIC CO INC</conformed-name></company-info></feed>`;
    assert.equal(cikFromBrowse(atom, "Graybar Electric Company"), "0000205402");
    const list = `<tr><td><a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001606163&amp;type=10-K">0001606163</a></td><td scope="row">LIMBACH HOLDINGS, INC.</td></tr>`;
    assert.equal(cikFromBrowse(list, "Limbach Holdings"), "0001606163");
  });

  it("pulls the competition passage out of Item 1", () => {
    const filler = "We distribute electrical products. ".repeat(40);
    const html = `<p>Item 1. Business</p><p>${filler}</p><p>Competition</p><p>We compete with Wesco, Sonepar, Rexel and CED.</p><p>${filler}</p><p>Item 1A. Risk Factors</p><p>${filler}</p>`;
    assert.match(tenKExcerpts(html).competition ?? "", /Wesco, Sonepar, Rexel and CED/);
  });

  it("a 10-K's competitor list is used as is", async () => {
    const searcher = { search: async () => { throw new Error("no search for a 10-K filer"); } };
    const r = await new CompetitorAgent({ fetchText: async () => null }, searcher).run("Graybar Electric Company", undefined, {
      filed: { names: ["Wesco International", "Sonepar", "Rexel", "Graybar"], url: "https://www.sec.gov/10k.htm" },
    });
    assert.deepEqual(r.competitors.map((c) => c.name), ["Wesco International", "Sonepar", "Rexel"]);
    assert.equal(r.sources[0].usedFor[0], "competitors");
  });
});

describe("round six: news (fixes 43, 46, 49)", () => {
  it("news needs the name, not the legal name or the city, once a site settled the company", () => {
    const rec = { name: "Homeboy Industries", anchor: { location: "Los Angeles, CA" }, domain: "homeboyindustries.org" };
    assert.equal(newsAboutSubject("Homeboy Industries launches $100M campaign", "https://latimes.com/a", rec), true);
    const graybar = { name: "Graybar Electric Company", anchor: {}, domain: "graybar.com" };
    assert.equal(newsAboutSubject("Graybar names new president", "https://x.com/a", graybar, ["Graybar"]), true);
    // Namesakes known: the city still has to match.
    assert.equal(newsAboutSubject("Homeboy Industries opens", "https://x.com/a", { ...rec, anchor: { ...rec.anchor, unlisted: true } }), false);
  });

  it("drops gossip and labels plaintiff-firm solicitations", () => {
    assert.equal(isPersonalLifeNews("Crumbl co-founder's divorce gets messy", undefined, "https://x.com/a"), true);
    assert.equal(isPersonalLifeNews("Crumbl closes 57 stores", undefined, "https://www.dailymail.co.uk/a"), true);
    assert.equal(isPersonalLifeNews("Crumbl closes 57 stores", undefined, "https://www.wsj.com/a"), false);
    assert.equal(isLawFirmSolicitation("Limbach Holdings (LMB) Investors: Pomerantz Law Firm announces investigation"), true);
    assert.equal(isLawFirmSolicitation("Limbach buys 1901 Inc. for $63M"), false);
  });
});

describe("round six: leadership (fix 44)", () => {
  it("same person under two spellings and name orders", () => {
    assert.equal(samePerson("Lilia Agadganian, M.S., BCBA", "Lili Agadganian"), true);
    assert.equal(samePerson("AGADGANIAN, LILIA", "Lilia Agadganian"), true);
    assert.equal(samePerson("Lilit Gevoglanian", "Lilia Agadganian"), false);
    assert.equal(cleanLeadership([{ name: "Lilia Agadganian", title: "Co-founder" }, { name: "Lili Agadganian, BCBA", title: "CEO" }]).length, 1);
  });

  it("tidies titles", () => {
    assert.equal(tidyTitle("coo"), "COO");
    assert.equal(tidyTitle("co-founder and ceo"), "Co-founder and CEO");
  });

  it("two undated sources that disagree keep both people", () => {
    const out = resolveTitleConflicts([
      { name: "Jason McGowan", title: "CEO", sourceUrl: "https://crumblcookies.com/about" },
      { name: "Sawyer Hemsley", title: "CEO", sourceUrl: "https://example.com/a" },
    ], "crumblcookies.com");
    assert.equal(out.length, 2);
  });

  it("a dated appointment in the news settles a title", () => {
    const appointed = appointmentsFromNews([{ headline: "ACCO Engineered Systems names Chuck Darway president", date: "Oct 1, 2026", url: "https://news.example/acco" }]);
    assert.deepEqual(appointed.map((a) => [a.name, a.title]), [["Chuck Darway", "President"]]);
    const list = cleanLeadership(applyAppointments([
      { name: "Jeffrey Marrs", title: "President and CEO", sourceUrl: "https://accoes.com/leadership" },
      { name: "Chuck Darway", title: "COO", sourceUrl: "https://accoes.com/leadership" },
    ], appointed), "accoes.com");
    assert.equal(list.find((l) => l.name === "Jeffrey Marrs")!.title, "CEO");
    assert.match(list.find((l) => l.name === "Chuck Darway")!.title, /President/);
    // "Names" in other words aren't people.
    assert.deepEqual(appointmentsFromNews([{ headline: "Board names new president for local chapter", date: "Oct 1, 2026", url: "u" }]), []);
  });

  it("a founder the company's copy doesn't name loses the title", () => {
    const founders = foundedBy(["Homeboy Industries was founded in 1988 by Father Greg Boyle in Boyle Heights."]);
    assert.deepEqual(founders, ["Father Greg Boyle"]);
    const out = checkFoundersAgainst([
      { name: "Gregory Boyle", title: "Founder" },
      { name: "Martin Cabrera Jr.", title: "CEO and Founder" },
    ], founders);
    assert.equal(out.find((l) => l.name.startsWith("Martin"))!.title, "CEO");
  });
});

describe("round six: site crawl (fix 50)", () => {
  it("inner pages lose the menu the homepage already has", () => {
    const nav = "Home About Robots Solutions Careers Contact ".repeat(10);
    const body = pageBody(`<html><nav>${nav}</nav><main><h1>Our robots</h1><p>Rapid Ultrasonic Gridding crawler.</p></main></html>`, `${nav} Welcome`);
    assert.equal(body, "Our robots Rapid Ultrasonic Gridding crawler.");
  });

  it("short pages hand their share to long ones", () => {
    assert.deepEqual(budgetShares([100, 5000, 5000], 3000), [100, 1450, 1450]);
  });
});

describe("round six: synthesis (fixes 45, 46, 48)", () => {
  it("one announced ceiling is one contract", () => {
    const awards = [{ amount: "$2,000,000", awardingAgency: "General Services Administration" }, { amount: "$1,400,000", awardingAgency: "Department of Defense" }];
    const news = [{ headline: "Gecko wins $300M GSA and Department of Defense contract", url: "https://n/1", date: "Oct 20, 2026" }];
    const c = contractCeilings(awards, news);
    assert.equal(c.length, 1);
    assert.equal(c[0].agency, "GSA / Department of Defense");
    assert.equal(c[0].obligated, 3_400_000);
  });

  it("clusters same-day suits and states trends", () => {
    const cases: CaseRecord[] = ["Blyden", "Sims", "Guay"].map((p) => ({ caption: `${p} v. Graybar Electric Company`, court: "E.D. Mo.", filed: "2026-10-02",
      role: "defendant", caseType: "Personal Injury", url: `https://cl/${p}` }));
    assert.match(caseClusters(cases)[0].text, /^3 Personal Injury suits against the company \(Blyden, Sims, Guay\) filed in E\.D\. Mo\. on the same day/);
    assert.equal(trendLine("Expenses", [{ year: "2021", value: 22.5e6 }, { year: "2023", value: 40.1e6 }]), "Expenses rose 78% from $22.5M (2021) to $40.1M (2023)");
  });

  it("past awards aren't opportunities", () => {
    const facts: Fact[] = [{ text: "Federal award (past): $1M, Navy, 2013-05-01", when: "2013-05-01", kind: "award", url: "u" }, { text: "News: expanding to Arizona", kind: "news", url: "v", when: "2026-09-01" }];
    assert.equal(isHistoryOnly([1], facts), true);
    assert.equal(isHistoryOnly([1, 2], facts), false);
  });

  it("sentences the case records contradict are dropped", () => {
    const closed: CaseRecord = { caption: "A v. Crumbl", url: "u", role: "defendant", status: "closed" };
    const open: CaseRecord = { caption: "B v. Crumbl", url: "v", role: "defendant", status: "open" };
    const facts: Fact[] = [{ text: "Case: A", caseRef: closed, url: "u" }, { text: "Case: B", caseRef: open, url: "v" }];
    assert.equal(contradictsCases("Crumbl filed multiple lawsuits as a defendant.", [1, 2], facts), true);
    assert.equal(contradictsCases("All of its cases remain open.", [1, 2], facts), true);
    assert.equal(contradictsCases("It faces an open suit from B.", [2], facts), false);
  });
});

describe("round six: funding (fix 47)", () => {
  it("reads a fund target", () => {
    const t = fundTargets([{ text: "MJW launched the MJW Student Housing Fund, targeting up to $100 million in equity.", url: "https://mjw.com/funds" }], "MJW Investments");
    assert.deepEqual(t.map((x) => [x.round, x.amount]), [["MJW Student Housing Fund (target)", "$100 million"]]);
  });

  it("searches Form D by the sponsor's short name", async () => {
    const asked: string[] = [];
    await withFetch((url) => {
      asked.push(url);
      if (url.includes("efts") && url.includes("fund")) {
        return Response.json({ hits: { hits: [{ _id: "0001-26-000001:primary_doc.xml", _source: { ciks: ["0001"], adsh: "0001-26-000001", display_names: ["MJW Student Housing Fund I, LLC  (CIK 0000000001)"], file_date: "2026-06-10" } }] } });
      }
      if (url.includes("efts")) return Response.json({ hits: { hits: [] } });
      return new Response("<edgarSubmission></edgarSubmission>");
    }, async () => {
      const r = await new PublicFilingsAgent({ search: async () => [] }).formDFilings(["MJW Investments"], "MJW");
      assert.equal(r.funding[0].round, "Form D: MJW Student Housing Fund I, LLC");
    });
  });
});

describe("round six: P2", () => {
  it("a domain with no mail servers isn't flagged Medium for SPF and DMARC", () => {
    const p = evaluatePosture({ domain: "crumblcookies.com", mx: [], txt: [], dmarc: [] });
    for (const id of ["spf", "dmarc"]) assert.equal(p.checks.find((c) => c.id === id)!.severity, "low");
  });

  it("reads newer 990 years off the organization page", () => {
    const html = `<div>Fiscal year ending Dec. 2024</div><div>Total Revenue $46,950,000</div><div>Total Functional Expenses $41,680,000</div><div>Total Assets $110,040,000</div>
      <div>Fiscal year ending Dec. 2023</div><div>Total Revenue $44,000,000</div>`;
    const years = pageYears(html);
    assert.equal(years[0].year, "2024");
    assert.equal(years[0].revenue, 46_950_000);
    assert.equal(years[0].assets, 110_040_000);
  });

  it("CourtListener keeps page one when page two fails", async () => {
    let calls = 0;
    await withFetch(() => {
      calls++;
      if (calls === 1) return Response.json({ results: [{ caseName: "A v. MJW Investments", docket_absolute_url: "/docket/1/" }], next: "https://www.courtlistener.com/api/rest/v4/search/?page=2" });
      throw new Error("timeout");
    }, async () => {
      const r = await new CourtListenerAgent().run('"MJW Investments"', 3);
      assert.equal(r.records.length, 1);
      assert.equal(r.failed, undefined);
    });
  });
});
