import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cikFromSearch, fiscalYears, latestFiling, proxyExcerpts, sectionText, tenKExcerpts } from "./index.js";
import { caseContext, caseRole, rankCases, type CaseRecord } from "../public-filings-agent/index.js";
import { applySecFilings, isNationalScale } from "../orchestrator/index.js";
import { ReportAgent } from "../report-agent/index.js";
import type { ResearchBundle } from "../../types/research.js";

const fy = (start: string, end: string, val: number, filed = "2026-03-01") => ({ start, end, val, form: "10-K", fp: "FY", filed });

describe("SEC filings, parsed (launch fix 19)", () => {
  it("finds the CIK from a full-text search hit by filer name", () => {
    assert.equal(cikFromSearch([
      { _source: { ciks: ["0000999999"], display_names: ["GRAYBAR LANE LLC  (CIK 0000999999)"] } },
      { _source: { ciks: ["0000205402"], display_names: ["GRAYBAR ELECTRIC CO INC  (CIK 0000205402)"] } },
    ], "Graybar Electric Company"), "0000205402");
  });

  it("reads fiscal-year revenue, net income and gross margin, newest first", () => {
    const years = fiscalYears({ facts: { "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
        fy("2025-01-01", "2025-12-31", 12_880_000_000), fy("2024-01-01", "2024-12-31", 11_500_000_000),
        { start: "2025-04-01", end: "2025-06-30", val: 3e9, form: "10-Q", fp: "Q2", filed: "2025-08-01" },
      ] } },
      GrossProfit: { units: { USD: [fy("2025-01-01", "2025-12-31", 2_485_840_000), fy("2024-01-01", "2024-12-31", 2_311_500_000)] } },
      NetIncomeLoss: { units: { USD: [fy("2025-01-01", "2025-12-31", 300_000_000)] } },
    } } });
    assert.deepEqual(years.map((y) => y.year), ["2025", "2024"]);
    assert.equal(years[0].revenue, 12_880_000_000);
    assert.equal((years[0].grossMargin! * 100).toFixed(1), "19.3");
    assert.equal((years[1].grossMargin! * 100).toFixed(1), "20.1");
  });

  it("takes the 10-K section body, not the table of contents entry", () => {
    const filler = "The company is a defendant in lawsuits alleging asbestos exposure; 4,000 cases are pending. ".repeat(10);
    const html = `<p>Item 1A. Risk Factors 12</p><p>Item 3. Legal Proceedings 20</p><p>Item 4. Mine Safety 21</p>
      <p>Item 3. Legal Proceedings</p><p>${filler}</p><p>Item 4. Mine Safety Disclosures</p>`;
    assert.match(tenKExcerpts(html).legal ?? "", /4,000 cases are pending/);
    assert.equal(sectionText("Item 3. Legal Proceedings short Item 4.", /item\s*3\.?\s*legal proceedings/, /item\s*4\.?/), undefined);
    assert.match(proxyExcerpts(`<p>${"x ".repeat(400)} All directors other than Ms. Mazzarella are independent. ${"y ".repeat(400)}</p>`), /independent/);
  });

  it("picks the newest 10-K and proxy from the submissions list", () => {
    const sub = { filings: { recent: {
      form: ["8-K", "10-K", "DEF 14C", "10-K"], accessionNumber: ["1", "0000205402-26-000010", "0000205402-26-000012", "0000205402-25-000009"],
      filingDate: ["2026-04-01", "2026-03-05", "2026-03-20", "2025-03-06"], primaryDocument: ["a.htm", "gbe-20251231.htm", "def14c.htm", "old.htm"],
    } } };
    assert.deepEqual(latestFiling(sub, "0000205402", ["10-K"]), { url: "https://www.sec.gov/Archives/edgar/data/205402/000020540226000010/gbe-20251231.htm", date: "2026-03-05" });
    assert.equal(latestFiling(sub, "0000205402", ["DEF 14A", "DEF 14C"])?.date, "2026-03-20");
  });

  it("fills founding, incorporation, HQ and officers from the 10-K, and renders the section", () => {
    const bundle = {
      query: "Graybar", generatedAt: "2026-10-22T00:00:00Z", news: [], funding: [], competitors: [], products: [],
      company: { name: "Graybar Electric Company", website: "https://www.graybar.com" },
      leadership: [{ name: "Kathleen M. Mazzarella", title: "President", sourceUrl: "https://www.graybar.com/about" }],
      sources: [{ url: "https://www.sec.gov/x/10k.htm", retrievedAt: "", usedFor: ["sec-filings", "leadership"] }, { url: "https://www.graybar.com", retrievedAt: "", usedFor: ["overview"] }],
    } as unknown as ResearchBundle;
    const sec = {
      cik: "205402", name: "GRAYBAR ELECTRIC CO INC", stateOfIncorporation: "NY", businessAddress: "Clayton, MO",
      financials: [{ year: "2025", end: "2025-12-31", revenue: 12_880_000_000, grossMargin: 0.193 }, { year: "2024", end: "2024-12-31", revenue: 11.5e9, grossMargin: 0.201 }],
      founded: "1869", incorporatedYear: "1925", riskFactors: ["Asbestos litigation"], legalProceedings: "About 4,000 asbestos suits are pending.",
      executiveOfficers: [{ name: "Kathleen M. Mazzarella", title: "Chairman, President and Chief Executive Officer" }],
      board: { directors: [], independence: "All directors except the CEO are independent." },
      tenKUrl: "https://www.sec.gov/x/10k.htm", tenKDate: "2026-03-05",
    };
    bundle.secFilings = sec;
    applySecFilings(bundle, sec);
    assert.equal(bundle.company.founded, "1869");
    assert.equal(bundle.company.incorporated, "1925, NY");
    assert.equal(bundle.company.headquarters, "Clayton, MO");
    assert.equal(bundle.leadership[0].title, "Chairman, President and Chief Executive Officer");
    const md = new ReportAgent().generate(bundle);
    assert.match(md, /## SEC Filings[\s\S]*FY2025:\*\* revenue \$12\.88B · gross margin 19\.3%[\s\S]*FY2024[\s\S]*20\.1%/);
    assert.match(md, /Legal proceedings \(10-K\):\*\* About 4,000 asbestos suits/);
    assert.match(md, /Board:\*\* All directors except the CEO are independent/);
  });
});

describe("court context (launch fix 21) and scale (fixes 20, 22, 23)", () => {
  it("reads the company's side and status, and ranks suits against it first", () => {
    assert.equal(caseRole("Blyden v. Graybar Electric Company, Inc.", "Graybar Electric Company"), "defendant");
    assert.equal(caseRole("Graybar Electric Company v. Smith Electric", "Graybar Electric Company"), "plaintiff");
    assert.equal(caseRole("In re: Graybar Electric Company", "Graybar Electric Company"), "debtor");
    const adversary = caseContext({ caseName: "Graybar Electric Company v. Acme Builders", courtId: "moeb" }, "Graybar Electric Company");
    assert.equal(adversary.routine, true);
    const ranked = rankCases([
      { caption: "Graybar Electric Company v. Jones", url: "a", filed: "2016-03-01", role: "plaintiff", status: "closed" },
      { caption: "Graybar v. Acme (bankruptcy)", url: "b", filed: "2026-09-01", ...adversary },
      { caption: "Blyden v. Graybar Electric Company", url: "c", filed: "2026-10-02", role: "defendant", status: "open" },
      { caption: "Graybar Electric Company", url: "d", filed: "2025-09-12", role: "charged", court: "NLRB" },
    ] as CaseRecord[]);
    assert.deepEqual(ranked.map((c) => c.url), ["c", "d", "a", "b"]);
  });

  it("treats a company with many locations or a national footprint as national", () => {
    assert.ok(isNationalScale({ description: "Graybar distributes electrical products through 290+ locations." }));
    assert.ok(isNationalScale({ locations: ["A", "B", "C", "D", "E"] }));
    assert.ok(!isNationalScale({ description: "A pediatric ABA clinic in Burbank.", locations: ["Burbank, CA", "Valencia, CA"] }));
  });

  it("calls a matched location a franchise only when a source says so", () => {
    const md = new ReportAgent().generate({
      query: "X", generatedAt: "", leadership: [], products: [], news: [], funding: [], competitors: [],
      company: { name: "Graybar", brandLevel: true, anchor: { location: "Clayton, MO" } },
      sources: [{ url: "https://graybar.com", retrievedAt: "", usedFor: ["overview"] }],
    } as unknown as ResearchBundle);
    assert.match(md, /Clayton, MO — a location of Graybar/);
    assert.doesNotMatch(md, /franchise/);
  });
});
