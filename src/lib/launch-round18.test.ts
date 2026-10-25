import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filerMatchesSite, plausibleIncorporated } from "../agents/sec-filings-agent/index.js";
import { headquartersFromNews } from "../agents/orchestrator/index.js";
import { STATES } from "../agents/competitor-agent/index.js";
import { carryForward, profileFrom } from "./profile-cache.js";
import type { ResearchBundle } from "../types/research.js";

const now = Date.parse("2026-10-25");
const bundleOf = (over: Partial<ResearchBundle>): ResearchBundle => ({
  query: "x", generatedAt: "2026-10-25T00:00:00Z", company: { name: "X" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
} as ResearchBundle);

describe("round eighteen: Graybar's filer, headquarters, carried facts", () => {
  it("confirms a filer by the site's legal name and headquarters, never by name alone", () => {
    const graybar = { cik: "205402", name: "GRAYBAR ELECTRIC CO INC", city: "CLAYTON", state: "MO" };
    assert.equal(filerMatchesSite(graybar, "Graybar Electric Company", "Clayton, MO", STATES), true);
    assert.equal(filerMatchesSite(graybar, "Graybar Electric Company, Inc.", "Clayton, Missouri", STATES), true);
    // Round 19: the state, not the city (the SEC's record may read St. Louis).
    assert.equal(filerMatchesSite({ ...graybar, city: "ST LOUIS" }, "Graybar Electric Company", "Clayton, MO", STATES), true);
    assert.equal(filerMatchesSite(graybar, "Graybar Electric Company", "Chicago, IL", STATES), false);
    assert.equal(filerMatchesSite(graybar, undefined, "Clayton, MO", STATES), false);
    const gold = { cik: "1551206", name: "Patagonia Gold Corp.", city: "BUENOS AIRES", state: "C1" };
    assert.equal(filerMatchesSite(gold, "Patagonia, Inc.", "Ventura, California", STATES), false);
    assert.equal(filerMatchesSite({ cik: "1", name: "Patagonia Inc", city: "RENO", state: "NV" }, "Patagonia, Inc.", "Ventura, California", STATES), false);
  });

  it("drops an incorporation year that is the report's own year (Limbach '2025, DE')", () => {
    assert.equal(plausibleIncorporated("2025", "2026-03-02"), undefined);
    assert.equal(plausibleIncorporated("2014", "2026-03-02"), "2014");
  });

  it("reads a headquarters move from the news (Limbach to Tampa)", () => {
    const moved = headquartersFromNews([
      { headline: "Limbach Announces Relocation of Corporate Headquarters to Tampa", date: "Mar 2, 2026", url: "https://businesswire.com/x" },
      { headline: "Limbach Schedules Third Quarter 2026 Results", date: "Oct 20, 2026", url: "https://nasdaq.com/y" },
    ], "Limbach Holdings");
    assert.deepEqual(moved, { city: "Tampa", date: "Mar 2, 2026" });
    assert.equal(headquartersFromNews([{ headline: "Rival moves headquarters to Austin", date: "Mar 2, 2026" }], "Limbach Holdings"), undefined);
  });

  it("saves the headquarters the run settled on", () => {
    const rec = profileFrom(bundleOf({ company: { name: "Limbach", headquarters: "Tampa, FL", founded: "1901", foundedSource: "https://x.example" } }), "limbachinc.com");
    assert.equal(rec?.headquarters, "Tampa, FL");
  });

  it("carries no SEC officer, and a few recent stories", () => {
    const bundle = bundleOf({ company: { name: "Graybar" } });
    const story = (i: number, date: string) => ({ headline: `Story ${i}`, date, url: `https://news.example/${i}` });
    carryForward(bundle, [{
      leadership: [{ name: "D. A. Bender", title: "Senior Vice President", sourceUrl: "https://www.sec.gov/Archives/edgar/data/205402/x.htm", asOf: "2026-03-18" }],
      news: [story(1, "Oct 20, 2026"), story(2, "Oct 1, 2026"), story(3, "Jul 1, 2026"), story(4, "Sep 30, 2026"), story(5, "Sep 29, 2026"), story(6, "Sep 28, 2026")],
    }], "graybar.com", now);
    assert.equal(bundle.leadership.length, 0);
    assert.deepEqual(bundle.news.map((n) => n.headline), ["Story 1", "Story 2", "Story 4"]);
  });
});
