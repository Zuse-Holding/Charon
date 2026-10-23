import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { secFetch, SEC_USER_AGENT } from "./sec-http.js";
import { llmProblemMessage } from "./cost-tracking.js";
import { CoverageRecorder } from "./coverage/recorder.js";
import { nameOrDivision, partyIs, typoOf } from "./name-match.js";
import { caseRole, isParty } from "../agents/public-filings-agent/index.js";
import { recipientMatches } from "../agents/usaspending-agent/index.js";
import { isEnforcementAction, isEnforcementSource, isShoppingOrQuote, namesItself } from "./news-noise.js";
import { legalNameFrom } from "./entities/site-record.js";
import { NewsAgent } from "../agents/news-agent/index.js";
import { acquiredBy, enforcementCases, ownershipFrom } from "../agents/orchestrator/index.js";
import { subjectOrganization } from "../agents/propublica-nonprofit-agent/index.js";
import { lockedFacts, unsupportedDetail, type Fact } from "../agents/synthesis-agent/index.js";
import { cleanFunding } from "../agents/corporate-agent/index.js";
import { rankLeadership, samePerson, dedupeLeadership } from "./leadership.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";
import type { SearchProvider } from "./providers.js";

const withFetch = async (impl: (url: string, init?: RequestInit) => Response | Promise<Response>, fn: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => impl(String(input), init)) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = original; }
};

describe("round seven: infrastructure (fixes 52-54)", () => {
  it("every SEC request declares the User-Agent and accepts gzip", async () => {
    let headers: Record<string, string> = {};
    await withFetch((_url, init) => { headers = init?.headers as Record<string, string>; return Response.json({}); }, async () => {
      await secFetch("https://www.sec.gov/files/company_tickers.json");
    });
    assert.equal(headers["user-agent"], SEC_USER_AGENT);
    assert.match(SEC_USER_AGENT, /^Metis Analytics \S+@metisanalytic\.com$/);
    assert.equal(headers["accept-encoding"], "gzip, deflate");
  });

  it("a rejected key reads as a configuration error, not a busy model", () => {
    assert.match(llmProblemMessage(["rate", "config"]), /rejected our API key/);
    assert.match(llmProblemMessage(["daily"]), /daily usage limit/);
    assert.doesNotMatch(llmProblemMessage([]), /busy/);
  });

  it("a 403 from a source is an error in the coverage table, never no matches", async () => {
    const cov = new CoverageRecorder(true, "company", "Limbach Holdings", {});
    await withFetch(() => new Response("Undeclared Automated Tool", { status: 403 }), async () => {
      await cov.run("edgar", async () => { await fetch("https://efts.sec.gov/LATEST/search-index?q=x"); return { n: 0 }; }, { n: 0 }, (r) => r.n);
    });
    const row = cov.result()!.find((e) => e.id === "edgar")!;
    assert.equal(row.status, "error");
    assert.match(row.reason ?? "", /403/);
  });
});

describe("round seven: entity anchoring (fixes 57, 58, 60, 67)", () => {
  it("a namesake isn't the company; its own units are", () => {
    assert.equal(nameOrDivision("TOWN OF PATAGONIA", "Patagonia"), false);
    assert.equal(nameOrDivision("Patagonia Seafarms", "Patagonia"), false);
    assert.equal(nameOrDivision("PATAGONIA, INC.", "Patagonia"), true);
    assert.equal(nameOrDivision("LIMBACH FACILITY SERVICES LLC", "Limbach Holdings"), true);
    assert.equal(recipientMatches("PATAGONIA UNIFIED SCHOOL DISTRICT", ["Patagonia"]), false);
    assert.equal(recipientMatches("STRIPES GLOBAL, INC.", ["stripe"]), false);
  });

  it("the role comes from exact parties in the caption", () => {
    assert.equal(caseRole("PATAGONIA, INC. v. PATAGONIA CANDLES LLC", ["Patagonia"]), "plaintiff");
    assert.equal(caseRole("Noresco LLC v. ACCO Engineering Systems, Inc.", ["ACCO Engineered Systems"]), "defendant");
    assert.equal(isParty("Patagonia Investments LLC v. Smith", ["Patagonia", "Patagonia, Inc."]), false);
    assert.equal(partyIs("Town of Patagonia", ["Patagonia"]), false);
  });

  it("a typed slip resolves to the site's name, and the copyright line gives the legal name", () => {
    assert.equal(typoOf("Pomise ABA", "Promise ABA"), true);
    assert.equal(typoOf("Crmbl", "Crumbl"), true);
    assert.equal(typoOf("Patagonia", "Columbia"), false);
    assert.equal(legalNameFrom("Shop jackets © 2026 Patagonia, Inc. All Rights Reserved."), "Patagonia, Inc.");
    assert.equal(legalNameFrom("Copyright 2025 Crumbl, LLC | Privacy"), "Crumbl, LLC");
  });

  it("funding articles must be about the company itself", () => {
    assert.equal(namesItself("Patagonia Health Raises $30M Series A", "Patagonia"), false);
    assert.equal(namesItself("Patagonia sues Gap over fleece", "Patagonia"), true);
    assert.deepEqual(cleanFunding([{ round: "Round", amount: "$36 million" }, { round: "Series B", amount: "$40M" }]).map((f) => f.round), ["Series B"]);
  });
});

describe("round seven: news (fixes 61, 62)", () => {
  it("a local company's short name alone never matches", async () => {
    const searcher: SearchProvider = {
      search: async () => [],
      news: async () => [
        { title: "Congress revives the Dream and Promise Act", url: "https://news.example/a", date: "Oct 1, 2026" },
        { title: "Promise ABA opens Valencia clinic", url: "https://news.example/b", date: "Oct 2, 2026" },
      ],
    };
    const r = await new NewsAgent({ fetchText: async () => null }, searcher).run("Promise ABA", {}, "promiseaba.com");
    assert.deepEqual(r.news.map((n) => n.headline), ["Promise ABA opens Valencia clinic"]);
  });

  it("drops sale articles and stock-quote pages", () => {
    assert.equal(isShoppingOrQuote("Patagonia Black Friday sale: 40% off fleece", "https://deals.example/a"), true);
    assert.equal(isShoppingOrQuote("Limbach Holdings (LMB) stock price", "https://finance.yahoo.com/quote/LMB/"), true);
    assert.equal(isShoppingOrQuote("Limbach buys 1901 Inc.", "https://news.example/c"), false);
  });

  it("agency actions become case records against the company", () => {
    assert.equal(isEnforcementSource("https://www.justice.gov/opa/pr/x"), true);
    const cases = enforcementCases([{ headline: "United States v. ACCO Engineered Systems, Inc.", url: "https://www.justice.gov/usao/pr/acco", date: "Jul 25, 2026", enforcement: true }], ["ACCO Engineered Systems"]);
    assert.equal(cases[0].role, "defendant");
    assert.equal(cases[0].court, "U.S. Department of Justice");
  });

  it("only actions naming the company count as enforcement (fix 76)", () => {
    const yes = (title: string, url: string, names: string[], snippet?: string) => isEnforcementAction({ title, url, snippet }, names);
    assert.equal(yes("United States v. ACCO Engineered Systems, Inc.", "https://www.justice.gov/usao-cdca/pr/acco", ["ACCO Engineered Systems"]), true);
    assert.equal(yes("Contractor Agrees to Pay $2 Million to Resolve False Claims Act Allegations", "https://www.justice.gov/opa/pr/x", ["ACCO Engineered Systems"],
      "ACCO Engineered Systems, Inc. agreed to pay..."), true);
    // Graybar's own filings, Gecko's Form D, Limbach's 10-K and press release exhibit.
    assert.equal(yes("Graybar Electric Company, Inc. 10-K 2024", "https://www.sec.gov/Archives/edgar/data/205402/x.htm", ["Graybar Electric Company"]), false);
    assert.equal(yes("Graybar Electric Company Annual Report", "https://www.sec.gov/files/graybar.pdf", ["Graybar Electric Company"]), false);
    assert.equal(yes("Gecko Robotics, Inc. - Form D", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany", ["Gecko Robotics"]), false);
    assert.equal(yes("Limbach Holdings Completes Acquisition", "https://www.sec.gov/Archives/edgar/data/1606163/ex99.htm", ["Limbach Holdings"]), false);
    // Homeboy: a DOJ video and a trip readout.
    assert.equal(yes("Father Greg Boyle of Homeboy Industries speaks at reentry conference", "https://www.justice.gov/video/x", ["Homeboy Industries"]), false);
    assert.equal(yes("Readout of Deputy Attorney General's visit to Homeboy Industries", "https://www.justice.gov/opa/pr/readout", ["Homeboy Industries"]), false);
    // Patagonia: EPA research about the region, and a namesake's settlement.
    assert.equal(yes("Diatom records from Patagonia glacial lakes", "https://cfpub.epa.gov/si/x", ["Patagonia"]), false);
    assert.equal(yes("Patagonia Seafarms settles EPA Clean Water Act violations", "https://www.epa.gov/enforcement/x", ["Patagonia"]), false);
    // MJW: an old SEC PDF that is not an action against it.
    assert.equal(yes("MJW Investments comment letter", "https://www.sec.gov/rules/comments/2004/mjw.pdf", ["MJW Investments"]), false);
    assert.equal(yes("SEC Charges MJW Investments with fraud", "https://www.sec.gov/litigation/litreleases/2026/lr1.htm", ["MJW Investments"]), true);
  });

  it("a company's foundation is not the company (fix 77)", () => {
    const orgs = [{ ein: "1", name: "Graybar Foundation", url: "u1" }, { ein: "2", name: "Homeboy Industries", url: "u2" }];
    assert.equal(subjectOrganization(orgs, "Graybar"), undefined);
    assert.equal(subjectOrganization(orgs, "Homeboy Industries")?.ein, "2");
    assert.equal(subjectOrganization([{ ein: "3", name: "Gates Foundation", url: "u3" }], "Gates Foundation")?.ein, "3");
  });

  it("the company's own suit against the government is not a charge", () => {
    const cases = enforcementCases([{ headline: "Patagonia, Inc. v. United States", url: "https://www.justice.gov/civil/x", date: "2025", enforcement: true }], ["Patagonia"]);
    assert.equal(cases[0].role, "plaintiff");
  });
});

describe("round seven: synthesis (fixes 58, 59, 68)", () => {
  it("suits the company brought are summed up, never offered as risks", () => {
    const bundle = { query: "x", generatedAt: "", company: { name: "Patagonia" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
      courtCases: [1, 2, 3].map((i) => ({ caption: `Patagonia, Inc. v. Knockoff ${i}`, url: `https://cl/${i}`, role: "plaintiff" as const, caseType: "Trademark" })) } as ResearchBundle;
    const facts = lockedFacts(bundle);
    assert.ok(!facts.some((f) => f.text.startsWith("Case:")));
    assert.ok(facts.some((f) => /Suits it brought \(not risks\): 3 as plaintiff, 3 over trademarks/.test(f.text)));
  });

  it("drops a risk with a detail its facts don't state", () => {
    const facts: Fact[] = [{ text: "Case: Northwest Administrators v. ACCO Engineered Systems (W.D. Wash., filed 2025-03-01, company is the defendant)", url: "u" }];
    assert.equal(unsupportedDetail("ACCO faces a civil rights suit from Northwest Administrators.", [1], facts, "ACCO Engineered Systems"), "civil rights");
    assert.equal(unsupportedDetail("ACCO faces a California suit from Northwest Administrators.", [1], facts, "ACCO Engineered Systems"), "California");
    assert.equal(unsupportedDetail("ACCO faces a suit filed August 2026.", [1], facts, "ACCO Engineered Systems"), "August 2026");
    assert.equal(unsupportedDetail("ACCO is the defendant in a suit from Northwest Administrators.", [1], facts, "ACCO Engineered Systems"), undefined);
  });

  it("each risk links to its source", () => {
    const bundle = { query: "x", generatedAt: "", company: { name: "Acme" }, leadership: [], products: [], news: [], funding: [], competitors: [],
      sources: [{ url: "https://cl/1", title: "c", retrievedAt: "", usedFor: ["risks"] }],
      risks: ["An open suit names Acme."], synthesisCitations: { "An open suit names Acme.": ["https://cl/1"] } } as ResearchBundle;
    assert.match(new ReportAgent().generate(bundle), /- An open suit names Acme\. \(\[source\]\(https:\/\/cl\/1\)\)/);
  });
});

describe("round seven: P1 (fixes 65, 66, 68)", () => {
  it("a company it bought is not a competitor", () => {
    assert.equal(acquiredBy(["Graybar acquired Metro Electric Supply in 2021."], "Metro Electric Supply"), true);
    assert.equal(acquiredBy(["Graybar competes with Wesco."], "Wesco"), false);
  });

  it("finds ownership in collected text", () => {
    assert.deepEqual(ownershipFrom([{ text: "Patagonia is owned by the Patagonia Purpose Trust and the Holdfast Collective.", url: "https://littlesis.org/x" }]),
      { note: "Owned by the Patagonia Purpose Trust and the Holdfast Collective", url: "https://littlesis.org/x" });
  });

  it("executives first; managers drop once three executives are listed", () => {
    const out = rankLeadership([
      { name: "A", title: "District Manager" }, { name: "B", title: "Senior Vice President" }, { name: "C", title: "CEO" },
      { name: "D", title: "Chief Financial Officer" }, { name: "E", title: "Branch Manager" },
    ]);
    assert.deepEqual(out.map((l) => l.name), ["C", "D", "B"]);
  });

  it("merges a spelling slip in a last name, and ignores titles from another organization's site", () => {
    assert.equal(samePerson("Lilia Agadganian", "Lilia Agadjanian"), true);
    const out = dedupeLeadership([
      { name: "Mark Weinstein", title: "Managing Partner", sourceUrl: "https://mjwinvestments.com/team" },
      { name: "Mark Weinstein", title: "Board Chair", sourceUrl: "https://dignitymoves.org/board" },
    ], "mjwinvestments.com");
    assert.equal(out[0].title, "Managing Partner");
  });
});
