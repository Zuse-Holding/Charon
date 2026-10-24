import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sourceTime, staleParent } from "./entity-type.js";
import { applyDepartures } from "./leadership.js";
import { stockListingFor } from "../agents/website-agent/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const now = Date.parse("2026-10-24");

describe("round sixteen (a): summary guards from Round 15", () => {
  it("drops a parent only old sources name (Limbach and 1347 Capital)", () => {
    const note = "Wholly-owned subsidiary of 1347 Capital";
    const old = [
      { url: "https://www.sec.gov/Archives/edgar/data/2016/07/8-k.htm", text: "Limbach Holdings, wholly-owned subsidiary of 1347 Capital Corp" },
      { url: "https://news.example/limbach-merger", date: "Jul 21, 2016", text: "1347 Capital completes merger with Limbach" },
    ];
    assert.equal(staleParent(note, old, now), true);
    // A current source naming the parent keeps it.
    assert.equal(staleParent(note, [...old, { url: "https://news.example/x", date: "3 months ago", text: "a unit of 1347 Capital" }], now), false);
    // Undated sources alone can't say.
    assert.equal(staleParent(note, [{ url: "https://example.com/about", text: "subsidiary of 1347 Capital" }], now), false);
    // A source that doesn't name the parent isn't evidence either way.
    assert.equal(staleParent("Owned by VF Corporation", old, now), false);
  });

  it("dates a source by its reported date, else the year in its address", () => {
    assert.equal(sourceTime({ url: "https://x.example/a", date: "2 days ago" }, now), now - 2 * 86_400_000);
    assert.equal(sourceTime({ url: "https://x.example/2016/07/a" }, now), Date.parse("2016-07-01"));
    assert.equal(sourceTime({ url: "https://x.example/a" }, now), undefined);
  });

  it("reads its own ticker from a news line, not a partner's", () => {
    assert.equal(stockListingFor("1901 Inc. sold to Limbach Holdings, Inc. (NASDAQ: LMB) for $63M", ["Limbach Holdings"]), "NASDAQ: LMB");
    assert.equal(stockListingFor("Limbach wins a contract from partner Comfort Systems (NYSE: FIX)", ["Limbach Holdings"]), undefined);
  });

  it("never puts a site-fetch error in the summary (Crumbl)", () => {
    const md = new ReportAgent().generate({
      query: "Crumbl", generatedAt: "2026-10-24T00:00:00Z", leadership: [], products: [], news: [], funding: [], competitors: [],
      sources: [{ url: "https://maps.example/crumbl", title: "Business listing", retrievedAt: "2026-10-24T00:00:00Z", usedFor: ["overview"] }],
      company: { name: "Crumbl", website: "https://crumblcookies.com", siteUnreadable: "the site couldn't be reached",
        description: "Crumbl sells fresh-baked cookies for delivery, pickup or carryout." },
    } as ResearchBundle);
    const summary = md.split("## Executive Summary")[1].split("\n## ")[0];
    assert.doesNotMatch(summary, /couldn't read|couldn't be reached/i);
    assert.match(summary, /Crumbl sells fresh-baked cookies/);
  });

  it("re-labels or drops leaders newer news says stepped down (Crumbl)", () => {
    const news = [{ headline: "Crumbl co-founders Jason McGowan and Sawyer Hemsley step down as co-CEOs", date: "May 12, 2026" }];
    const out = applyDepartures([
      { name: "Jason McGowan", title: "Co-founder, CEO" },
      { name: "Sawyer Hemsley", title: "Co-CEO" },
      { name: "Jane Doe", title: "CFO" },
    ], news);
    assert.deepEqual(out.map((l) => `${l.name}: ${l.title}`), ["Jason McGowan: Co-founder", "Jane Doe: CFO"]);
  });

  it("matches a headline that names only the founders, and keeps a seat the story says stays", () => {
    const out = applyDepartures([{ name: "Jason McGowan", title: "Founder and CEO" }],
      [{ headline: "Crumbl founders step down from day-to-day roles", date: "May 12, 2026" }]);
    assert.equal(out[0].title, "Founder");
    const chair = applyDepartures([{ name: "Pat Rivera", title: "CEO, Chairman" }],
      [{ headline: "Pat Rivera steps down as CEO but remains chairman", date: "Jun 1, 2026" }]);
    assert.equal(chair[0].title, "Chairman");
  });

  it("leaves a leader whose listing is newer than the departure story", () => {
    const out = applyDepartures([{ name: "Pat Rivera", title: "CEO", asOf: "Sep 1, 2026" }],
      [{ headline: "Pat Rivera steps down as CFO", date: "Jan 5, 2026" }]);
    assert.equal(out[0].title, "CEO");
  });
});
