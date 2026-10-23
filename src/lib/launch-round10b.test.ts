import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nameOrDivision } from "./name-match.js";
import { rankLeadership } from "./leadership.js";
import { sourceById } from "./coverage/registry.js";
import { fetchPageText, type FetchProvider } from "./providers.js";
import { isNationalScale } from "../agents/orchestrator/index.js";
import { NewsAgent } from "../agents/news-agent/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

type Result = { title: string; url: string; snippet?: string; date?: string };

describe("round ten (b): fix 84", () => {
  it("agency actions survive OSHA inspections, and news is newest first, located or not", async () => {
    const osha = (id: string) => ({ title: `Inspection: ${id} - Acco Engineered Systems, Inc.`, url: `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${id}`, snippet: "Site Address: Acco Engineered Systems, Inc." });
    const searcher = {
      async search(q: string): Promise<Result[]> {
        if (q.includes("site:justice.gov")) return [{ title: "United States v. ACCO Engineered Systems, Inc.", url: "https://www.justice.gov/eoir/media/1452076/dl", snippet: "ACCO Engineered Systems, Inc." }];
        if (q.includes("site:osha.gov")) return ["1", "2", "3", "4"].map(osha);
        if (q.includes("site:sec.gov")) return [];
        if (q.includes("Glendale")) return [{ title: "ACCO Engineered Systems sells Glendale warehouse", url: "https://n.example/2019", date: "Mar 4, 2019" }];
        return [
          { title: "ACCO Engineered Systems opens Arizona piping facility", url: "https://n.example/az", date: "Oct 2, 2026" },
          { title: "About ACCO - ACCO Engineered Systems", url: "https://www.accoes.com/about/" },
        ];
      },
      async news(): Promise<Result[]> { return []; },
    };
    const r = await new NewsAgent({ fetchText: async () => null }, searcher as never).run("ACCO Engineered Systems", { location: "Glendale, CA" }, "accoes.com");
    const heads = r.news.map((n) => n.headline);
    assert.equal(heads[0], "ACCO Engineered Systems opens Arizona piping facility");
    assert.ok(heads.includes("United States v. ACCO Engineered Systems, Inc."));
    assert.ok(!heads.some((h) => h.startsWith("About ACCO")));
    assert.equal(r.news.filter((n) => n.url?.includes("osha.gov")).length, 3);
  });

  it("the web-search source never watches sec.gov, and sec.gov pages wait for SEC_ENABLED", async () => {
    assert.deepEqual(sourceById("sec").hosts?.some((h) => /sec\.gov/.test(h)), false);
    let fetched = false;
    const fetcher: FetchProvider = { fetchText: async () => { fetched = true; return "x".repeat(500); } };
    assert.equal(await fetchPageText("https://www.sec.gov/Archives/edgar/data/1/x.htm", fetcher), null);
    assert.equal(fetched, false);
  });

  it("the Insider Activity row shows a total for a per-share price", () => {
    const report = new ReportAgent().generate({ query: "x", generatedAt: "", company: { name: "Limbach Holdings" }, leadership: [], products: [], news: [], funding: [], competitors: [],
      sources: [{ url: "https://www.secform4.com/x", title: "Form 4", retrievedAt: "", usedFor: ["insider-activity"] }],
      insiderActivity: [{ filerName: "Jayme L. Brooks", relationship: "CFO", transactionType: "Sell", shares: "5,000", value: "$85.43 per share", date: "Mar 3, 2026", filingUrl: "https://www.secform4.com/x" }] } as ResearchBundle);
    assert.match(report, /Jayme L\. Brooks\*\* \(CFO\) — Sell · 5,000 shares · \$85\.43 per share · about \$427,150 total \(Mar 3, 2026\) \(\[filing\]\(https:\/\/www\.secform4\.com\/x\)\)/);
  });

  it("a bare name with a legal form is another entity when the subject's name goes on", () => {
    assert.equal(nameOrDivision("Homeboy Corporation", "Homeboy Industries"), false);
    assert.equal(nameOrDivision("Homeboy Industries, Inc.", "Homeboy Industries"), true);
    assert.equal(nameOrDivision("Limbach Inc.", "Limbach Holdings"), true);
    assert.equal(nameOrDivision("Patagonia, Inc.", "Patagonia"), true);
  });

  it("a national company never lists field managers, even with no executive found", () => {
    const managers = [{ name: "Pat Lee", title: "District Manager" }, { name: "Sam Roe", title: "Branch Manager" }];
    assert.equal(rankLeadership(managers, true).length, 0);
    assert.equal(rankLeadership(managers).length, 2);
  });

  it("North America's largest is national", () => {
    assert.equal(isNationalScale({ description: "Andersen is the largest window and door manufacturer in North America." }), true);
  });
});
