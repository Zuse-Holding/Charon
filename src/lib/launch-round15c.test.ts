import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDevelopments, gapQueries, namedAsBusiness, type GapSnippet } from "./gap-fill.js";
import { isShoppingOrQuote } from "./news-noise.js";
import { edIngVariant } from "../agents/public-filings-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const snip = (n: number, title: string, date?: string): GapSnippet => ({ n, title, url: `https://news.example/${n}`, text: `${title}. More on Crumbl.`, date, gap: "developments" });

describe("round fifteen (c): still-missing items from Round 14", () => {
  it("court search asks for both spellings of an -ed/-ing name (Noresco)", () => {
    assert.equal(edIngVariant("ACCO Engineered Systems"), "ACCO Engineering Systems");
    assert.equal(edIngVariant("Gecko Robotics"), undefined);
  });

  it("leadership changes and investments come before menus, one story once", () => {
    const now = Date.parse("2026-10-24");
    const bundle = { news: [] } as unknown as ResearchBundle;
    addDevelopments(bundle, [
      snip(1, "Crumbl Launches Country Week Menu with New S'mores Cookie", "Oct 1, 2026"),
      snip(2, "Crumbl Announces Minecraft Cookie Collaboration", "Sep 24, 2026"),
      snip(3, "Crumbl founders step down, begin CEO search", "May 27, 2026"),
      snip(4, "Crumbl Co-Founders Step Down: New Leadership Search Begins", "May 27, 2026"),
      snip(5, "Crumbl to Sell Minority Stake to TSG Consumer Partners", "May 1, 2025"),
    ], now);
    assert.deepEqual(bundle.news.map((n) => n.headline).slice(0, 2), ["Crumbl founders step down, begin CEO search", "Crumbl to Sell Minority Stake to TSG Consumer Partners"]);
    assert.ok(!bundle.news.some((n) => n.headline.startsWith("Crumbl Co-Founders Step Down")));
  });

  it("announcements and leadership go to the news index; investments to the web", () => {
    const qs = gapQueries("Crumbl", ["developments"]);
    assert.deepEqual(qs.map((q) => !!q.news), [true, true, false]);
    assert.ok(gapQueries("Gecko Robotics", ["products"]).some((q) => /launches/.test(q.query)));
  });

  it("a one-word name doing business counts as the company", () => {
    assert.equal(namedAsBusiness("Report: Crumbl to Sell Minority Stake to TSG Consumer Partners", "Crumbl"), true);
    assert.equal(namedAsBusiness("Crumbl Partners with Make-A-Wish Canada", "Crumbl"), true);
    assert.equal(namedAsBusiness("Hiking in Patagonia this fall", "Patagonia"), false);
  });

  it("pre-IPO ads and stock pitches aren't news", () => {
    assert.equal(isShoppingOrQuote("Invest in Series Gecko Robotics (2025 Round)", "https://x.example/a"), true);
    assert.equal(isShoppingOrQuote("Gecko Robotics Stock: $1.25B — Is It a Buy?", "https://x.example/b"), true);
    assert.equal(isShoppingOrQuote("TSG to invest in Crumbl", "https://x.example/c"), false);
  });
});
