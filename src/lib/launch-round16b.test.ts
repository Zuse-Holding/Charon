import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPlaceNamesake, newsDate, publishedDate } from "./news-noise.js";
import { isFillerOpportunity, mergeRuleRisks, ruleOpportunities, ruleRisks } from "./risk-rules.js";
import { applyDepartures, appointmentsFromNews } from "./leadership.js";
import { peerQueries } from "../agents/competitor-agent/index.js";
import { reportedSuits } from "../agents/orchestrator/index.js";
import type { CaseRecord } from "../agents/public-filings-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const now = new Date("2026-10-24T12:00:00Z");

describe("round sixteen (b): news into sections, dates, namesakes, filler, peers", () => {
  it("dates an article by its address over the search engine's coarse date", () => {
    // "5 months ago" put qz's May 12 story at May 27; the URL dates beat it.
    assert.equal(newsDate("5 months ago", "https://outdoormagazine.it/en/2026/05/06/patagonia-launches-appeal/", now), "May 6, 2026");
    assert.equal(newsDate("1 day ago", "https://www.latimes.com/california/story/2026-10-20/la28-homeboy-industries", now), "Oct 20, 2026");
    assert.equal(newsDate("2 months ago", "https://www.morningstar.com/news/pr-newswire/20260803cg18161/graybar-record-results", now), "Aug 3, 2026");
    assert.equal(newsDate("2 days ago", "https://qz.com/crumbl-founders-stepping-down-ceo-search-051226", now), "Oct 22, 2026");
  });

  it("reads the publish date the article's page states", () => {
    assert.equal(publishedDate(`<meta property="article:published_time" content="2017-12-06T18:30:00Z">`), "Dec 6, 2017");
    assert.equal(publishedDate(`<meta content="2026-04-02" itemprop="datePublished">`), "Apr 2, 2026");
    assert.equal(publishedDate(`<script type="application/ld+json">{"datePublished":"2026-05-12T09:00:00-04:00"}</script>`), "May 12, 2026");
    assert.equal(publishedDate("<p>no date here</p>"), undefined);
  });

  it("drops news about a place that shares the name (Patagonia)", () => {
    assert.equal(isPlaceNamesake("Patagonia’s New 231-Mile Lodge-to-Lodge Trek Is All About Protecting the Environment and Local Communities",
      "The best hotel amenity in Patagonia, in my humble opinion, is a mud room.", "Patagonia"), true);
    assert.equal(isPlaceNamesake("Big Tech eyes glacier-strewn Patagonia for building mega AI data centers", undefined, "Patagonia"), true);
    assert.equal(isPlaceNamesake("Inspection: 316578988 - Alpacas De La Patagonia", undefined, "Patagonia"), true);
    assert.equal(isPlaceNamesake("Patagonia Sues Trump Over Reduction of Bears Ears National Monument in Utah", undefined, "Patagonia"), false);
    assert.equal(isPlaceNamesake("Patagonia announces autumn 2026 Wetsuit Repair Tour across Europe", undefined, "Patagonia"), false);
    assert.equal(isPlaceNamesake("1901 Inc. sold to Limbach Holdings for $63M", undefined, "Limbach Holdings"), false);
  });

  it("treats menu prices and advocacy appeals as filler, not expansion", () => {
    assert.equal(isFillerOpportunity("Crumbl has launched a new Value Menu, including Dirty Sodas and cookies starting at 99¢, which could attract new customers."), true);
    assert.equal(isFillerOpportunity("Expansion under way: Patagonia launches an appeal to saving salmon in Iceland (outdoormagazine.it, May 6, 2026)."), true);
    assert.equal(isFillerOpportunity("Expansion under way: Crumbl launches $1.99 combos amid closures and falling sales."), true);
    assert.equal(isFillerOpportunity("Graybar is expanding through its third acquisition of 2026, Samson Electrical Supply."), false);

    const bundle = { company: { name: "Patagonia" }, funding: [], sources: [], news: [
      { headline: "Patagonia launches an appeal to saving salmon in Iceland", url: "https://a.example/1", date: "May 6, 2026", outlet: "a.example" },
      { headline: "Patagonia opens new distribution center in Reno", url: "https://a.example/2", date: "Apr 1, 2026", outlet: "a.example" },
    ] } as unknown as ResearchBundle;
    const grow = ruleOpportunities(bundle, ["Patagonia"], now.getTime()).find((r) => r.key === "expansion");
    assert.match(grow?.text ?? "", /distribution center/);
  });

  it("turns a nonprofit's fund drive into a campaign opportunity (Homeboy)", () => {
    const bundle = { company: { name: "Homeboy Industries", entityType: "nonprofit" }, funding: [], sources: [], news: [
      { headline: "Homeboy Industries, Georgetown public policy school team up for $100 million fund drive", url: "https://www.osvnews.com/x", date: "Jun 26, 2026", outlet: "osvnews.com" },
    ] } as unknown as ResearchBundle;
    assert.match(ruleOpportunities(bundle, ["Homeboy Industries"], now.getTime()).find((r) => r.key === "campaign")?.text ?? "", /\$100 million fund drive/);
  });

  it("reads the people a 'leadership changes' article names (Graybar)", () => {
    const out = appointmentsFromNews([{
      headline: "Graybar Announces Leadership Changes", date: "Apr 2, 2026", url: "https://tedmag.com/graybar-announces-leadership-changes-10/",
      articleText: "ST. LOUIS — Graybar announced today that David A. Bender, who currently serves as Senior Vice President – East Region, has been named Senior Vice President – North American Subsidiaries. Brian P. Delaney, who currently serves as Vice President, has been named Senior Vice President and General Manager.",
    }]);
    assert.deepEqual(out.map((l) => `${l.name}: ${l.title}`), [
      "David A. Bender: Senior Vice President – North American Subsidiaries",
      "Brian P. Delaney: Senior Vice President and General Manager",
    ]);
    // Without a leadership headline, the article text isn't read.
    assert.equal(appointmentsFromNews([{ headline: "Graybar wins award", date: "Apr 2, 2026", url: "https://x.example", articleText: "Jane Roe has been named President." }]).length, 0);
  });

  it("a social post's date doesn't outrank the departure story (Crumbl)", () => {
    const out = applyDepartures([{ name: "Jason McGowan", title: "CEO and Co-founder", asOf: "Oct 10, 2026",
      sourceUrl: "https://www.facebook.com/jasonmcgowan/posts/123" }],
      [{ headline: "Crumbl founders step down, begin CEO search", date: "May 12, 2026" }]);
    assert.equal(out[0].title, "Co-founder");
  });

  it("a change at the top becomes a risk, one over the cap (Crumbl)", () => {
    const bundle = { company: { name: "Crumbl" }, funding: [], sources: [], courtCases: [], news: [
      { headline: "Crumbl founders step down, begin CEO search", summary: "Crumbl co-founders Jason McGowan and Sawyer Hemsley are stepping away", url: "https://qz.com/crumbl", date: "May 12, 2026", outlet: "qz.com" },
    ] } as unknown as ResearchBundle;
    const rules = ruleRisks(bundle, ["Crumbl"], now.getTime()).filter((r) => r.key === "leadership");
    assert.equal(rules[0]?.text, "Leadership transition: Crumbl founders step down, begin CEO search (qz.com, May 12, 2026).");
    const six = ["a", "b", "c", "d", "e", "f"].map((x) => `Risk ${x} closed down`);
    assert.equal(mergeRuleRisks(six, {}, rules).risks.length, 7);
  });

  it("records a suit the news reports and no docket has (Bears Ears)", () => {
    const warner = { caption: "Warner Records Inc v. Crumbl LLC", url: "https://courtlistener.com/1" } as CaseRecord;
    const out = reportedSuits([
      { headline: "Patagonia Sues Trump Over Reduction of Bears Ears National Monument in Utah", url: "https://nytimes.com/x", date: "Dec 6, 2017" },
    ], ["Patagonia"], []);
    assert.equal(out[0]?.role, "plaintiff");
    assert.equal(out[0]?.filed, "Dec 6, 2017");
    assert.equal(reportedSuits([{ headline: "Warner Records sues Crumbl over TikTok music", url: "https://x.example", date: "Apr 22, 2025" }], ["Crumbl"], [warner]).length, 0);
  });

  it("searches a listed company's peers by scale", () => {
    assert.deepEqual(peerQueries("Limbach Holdings", { role: "commercial HVAC mechanical contractor", listed: true }),
      ["largest commercial HVAC mechanical contractors", "publicly traded commercial HVAC mechanical contractors NYSE NASDAQ"]);
  });
});
