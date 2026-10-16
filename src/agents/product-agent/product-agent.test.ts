import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNewsNoise, tagSources } from "./index.js";
import { ReportAgent } from "../report-agent/index.js";
import type { ProductResearchBundle } from "../../types/research.js";

describe("isNewsNoise", () => {
  it("drops social, video and forum hosts (the AirPods/Notion reports, 2026-10-15)", () => {
    assert.equal(isNewsNoise("https://www.reddit.com/r/airpods/comments/1s6s6v4/x/"), true);
    assert.equal(isNewsNoise("https://www.youtube.com/watch?v=6IOOTPK9Ki0"), true);
    assert.equal(isNewsNoise("https://youtu.be/abc"), true);
    assert.equal(isNewsNoise("https://www.facebook.com/groups/iosbeta/posts/1/"), true);
    assert.equal(isNewsNoise("https://old.reddit.com/r/x"), true);
  });

  it("drops template galleries, help centers and docs", () => {
    assert.equal(isNewsNoise("https://www.notion.com/templates/2026fullcalendar?srsltid=x"), true);
    assert.equal(isNewsNoise("https://www.notion.com/help/calendars"), true);
    assert.equal(isNewsNoise("https://example.com/docs"), true);
    assert.equal(isNewsNoise("https://support.apple.com/en-us/106340"), true);
    assert.equal(isNewsNoise("https://forums.macrumors.com/threads/next-airpods-pro.1/"), true);
  });

  it("keeps real coverage, including hosts that only look similar", () => {
    assert.equal(isNewsNoise("https://appleinsider.com/articles/26/08/02/apple-still-plans-update"), false);
    assert.equal(isNewsNoise("https://www.theverge.com/2026/1/1/notion-calendar"), false);
    assert.equal(isNewsNoise("https://notreddit.com/story"), false);
    assert.equal(isNewsNoise("https://example.com/helpful-guide"), false);
  });

  it("treats an unparseable URL as noise", () => {
    assert.equal(isNewsNoise("not a url"), true);
  });
});

describe("tagSources", () => {
  it("lists a URL once and merges the sections it fed", () => {
    const sources = tagSources([
      { results: [{ url: "https://a.com", title: "A" }, { url: "https://b.com" }], usedFor: ["overview", "product-details"] },
      { results: [{ url: "https://a.com", title: "A again" }], usedFor: ["product-details", "specs"] },
    ]);
    assert.equal(sources.length, 2);
    assert.deepEqual(sources[0].usedFor, ["overview", "product-details", "specs"]);
    assert.equal(sources[0].title, "A");
  });
});

describe("product report sources", () => {
  const bundle: ProductResearchBundle = {
    query: "Widget",
    generatedAt: "2026-10-15T00:00:00.000Z",
    product: { name: "Widget", brand: "Acme", category: "Gadget", price: "$10", description: "A widget." },
    specs: [{ label: "Size", value: "Small" }],
    competitors: [{ name: "Gizmo" }],
    news: [{ headline: "Widget 2 announced", url: "https://news.com/widget-2" }],
    pros: [], cons: [],
    sources: tagSources([
      { results: [{ url: "https://acme.com/widget" }], usedFor: ["overview", "product-details"] },
      { results: [{ url: "https://review.com/widget" }], usedFor: ["product-details", "specs"] },
      { results: [{ url: "https://vs.com/widget-vs-gizmo" }], usedFor: ["competitors"] },
      { results: [{ url: "https://news.com/widget-2" }], usedFor: ["news"] },
    ]),
  };
  const report = new ReportAgent().generateProduct(bundle);
  const section = (title: string) => report.split(`## ${title}`)[1].split("\n## ")[0];

  it("gives each section only the sources its search fed", () => {
    assert.match(section("Overview"), /acme\.com/);
    assert.doesNotMatch(section("Overview"), /review\.com|vs\.com|news\.com/);
    assert.match(section("Specs"), /review\.com/);
    assert.doesNotMatch(section("Specs"), /acme\.com/);
    assert.match(section("Competing Products"), /vs\.com/);
  });

  it("cites Recent News instead of marking it unverified", () => {
    assert.match(section("Recent News"), /\*\*Sources:\*\*/);
    assert.doesNotMatch(section("Recent News"), /Unverified/);
  });

  it("never lists the same URL twice in one section", () => {
    const urls = section("Product Details").match(/\]\((https?:[^)]+)\)/g) ?? [];
    assert.equal(urls.length, new Set(urls).size);
    assert.equal(urls.length, 2);
  });
});
