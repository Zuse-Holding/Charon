import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confirmBoardSeats, officialBioPages, orgSite } from "./person-sources.js";
import { isRoleTitle, personNews } from "./person-checks.js";
import { isIndexTitle } from "./news-noise.js";
import { orgFromTitle } from "./candidates.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { PersonResearchBundle } from "../types/research.js";

const personOf = (over: Partial<PersonResearchBundle>): PersonResearchBundle => ({
  query: "Jane Doe", generatedAt: "2026-10-28T00:00:00Z", person: { name: "Jane Doe" }, careerHistory: [], news: [], sources: [], ...over,
});

describe("round twenty-two: person search from the Oct 28 handoff", () => {
  it("a job title is never the organization a person is tied to", () => {
    for (const t of ["Board Member", "Chairman", "Chief Operating Officer", "General Counsel", "Senior Vice President", "Independent Director"]) {
      assert.equal(isRoleTitle(t), true, t);
    }
    for (const t of ["Graybar", "Limbach Holdings", "General Motors", "Principal Financial Group", "Executive Office of the President"]) {
      assert.equal(isRoleTitle(t), false, t);
    }
    assert.equal(orgFromTitle("Kathleen Mazzarella - Board Member - The Cigna Group", "Kathleen Mazzarella"), "The Cigna Group");
  });

  it("a board page vouches only for its own organization (no Amnesty seat for Mazzarella)", () => {
    const boardPages = [
      { url: "https://www.amnestyusa.org/aiusa-2026-board-election-results", text: "AIUSA 2026 Board of Directors Election Results. Kathleen Mazzarella of Graybar spoke at Cigna." },
      { url: "https://investors.thecignagroup.com/board-of-directors/person-details", text: "The Cigna Group board: Kathleen M. Mazzarella, Chairman and CEO, Graybar." },
      { url: "https://investors.wm.com/board", text: "WM board: Kathleen Mazzarella, Graybar." },
    ];
    const vouched = [{ url: "https://www.graybar.com/mazzarella", text: "She serves on the board of Core & Main." }];
    const seats = confirmBoardSeats([
      { organization: "Amnesty International USA", role: "Director" },
      { organization: "The Cigna Group", role: "Director" },
      { organization: "Waste Management" },
      { organization: "WM", role: "Non-executive chair" },
      { organization: "Core & Main" },
    ], { boardPages, vouched }, ["Graybar"]);
    assert.deepEqual(seats.map((s) => [s.organization, s.url]), [
      ["The Cigna Group", "https://investors.thecignagroup.com/board-of-directors/person-details"],
      ["WM", "https://investors.wm.com/board"],
      ["Core & Main", "https://www.graybar.com/mazzarella"],
    ]);
    assert.equal(orgSite("investors.wm.com", "WM"), true);
    assert.equal(orgSite("amnestyusa.org", "The Cigna Group"), false);
  });

  it("an about page on the company's site is a bio candidate even when its snippet doesn't name the person", () => {
    const pages = officialBioPages([
      { title: "About Us | Gecko Robotics", url: "https://www.geckorobotics.com/about-us", snippet: "We build robots." },
      { title: "Gecko Robotics careers", url: "https://www.geckorobotics.com/careers", snippet: "Join us." },
    ], "Jake Loosararian", "Gecko Robotics");
    assert.deepEqual(pages.map((p) => p.url), ["https://www.geckorobotics.com/about-us"]);
  });

  it("quote sites and news index pages stay out of news", () => {
    assert.equal(isIndexTitle("Limbach News Media."), true);
    assert.equal(isIndexTitle("Newsroom | Gecko Robotics"), true);
    assert.equal(isIndexTitle("Gecko Robotics wins $300M Navy contract for ship inspections"), false);
    const news = personNews([
      { title: "Limbach Holdings CEO Michael McCann Sells 10,000 Shares", url: "https://www.marketbeat.com/instant-alerts/lmb-insider-2026/", snippet: "" },
      { title: "Michael McCann Form 4", url: "https://www.stocktitan.net/sec-filings/LMB/form-4.html", snippet: "" },
      { title: "Limbach News Media.", url: "https://www.limbachinc.com/news-media/", snippet: "" },
      { title: "Limbach names Michael Reed chief operating officer", url: "https://www.businesswire.com/news/home/20260518/en/", snippet: "" },
    ], "Michael McCann");
    assert.deepEqual(news.map((n) => n.url), ["https://www.businesswire.com/news/home/20260518/en/"]);
  });

  it("the report shows education, founding and insider trades in their own places", () => {
    const md = new ReportAgent().generatePerson(personOf({
      person: { name: "Jane Doe", education: "BSME, Worcester Polytechnic Institute; MBA, Drexel University", founding: "Co-founded Gecko Robotics in 2013 with Troy Demmer; Y Combinator, Winter 2016." },
      insiderTrades: [{ filerName: "McCann Michael M.", transactionType: "Sell", shares: "10,000", date: "2026-05-01" }],
      coverage: [],
      sources: [
        { url: "https://www.limbachinc.com/mike-mccann/", title: "Bio", retrievedAt: "2026-10-28", usedFor: ["bio"] },
        { url: "https://openinsider.com/screener?s=LMB", title: "OpenInsider", retrievedAt: "2026-10-28", usedFor: ["insider-activity"] },
      ],
    }));
    const about = md.slice(md.indexOf("## About"), md.indexOf("## Source Coverage"));
    assert.match(about, /- \*\*Founded:\*\* Co-founded Gecko Robotics/);
    assert.match(md, /## Education\n- BSME, Worcester Polytechnic Institute\n- MBA, Drexel University/);
    assert.match(md, /## Insider Trades\n- Sell · 10,000 shares \(2026-05-01\)/);
  });
});
