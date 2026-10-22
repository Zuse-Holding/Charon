import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCitable, pageSupports, rankCitable, sourceTier } from "./source-quality.js";
import { cleanLeadership, personKey } from "./leadership.js";
import { crawlTargets } from "./entities/site-record.js";
import { peerQueries, regionOf } from "../agents/competitor-agent/index.js";
import { isLinkTitle } from "../agents/website-agent/index.js";

describe("source quality (launch P0)", () => {
  it("excludes forums and other vendors' competitor pages from the Stripe sample", () => {
    for (const url of [
      "https://www.reddit.com/r/SideProject/comments/18mrs2d/i_made_a_list/",
      "https://www.paddle.com/alternatives/stripe",
      "https://tipalti.com/resources/learn/stripe-competitors-and-alternatives/",
      "https://www.bluesnap.com/stripe-competitors/",
      "https://memberful.com/blog/stripe-competitors/",
      "https://attrock.com/stripe-competitors/",
      "https://www.chargeflow.io/blog/stripe-statistics",
    ]) assert.equal(isCitable(url, "stripe.com"), false, url);
  });

  it("ranks primary sources first and keeps the subject's own comparison pages", () => {
    assert.equal(sourceTier("https://stripe.com/blog/vs-paypal", "stripe.com"), "primary");
    assert.equal(sourceTier("https://www.sec.gov/cgi-bin/browse-edgar?company=x"), "primary");
    assert.equal(sourceTier("https://rocketreach.co/acco-management"), "directory");
    const ranked = rankCitable([
      { url: "https://someblog.example/post" },
      { url: "https://www.reuters.com/a" },
      { url: "https://www.reddit.com/r/x" },
    ]);
    assert.deepEqual(ranked.map((r) => r.url), ["https://www.reuters.com/a", "https://someblog.example/post"]);
  });

  it("confirms a claim only when the page names it", () => {
    assert.ok(pageSupports("Top contractors: EMCOR Group, Comfort Systems USA.", "Comfort Systems USA"));
    assert.ok(!pageSupports("Top contractors: EMCOR Group.", "Comfort Systems USA"));
    assert.ok(!pageSupports(null, "EMCOR"));
  });
});

describe("leadership clean-up (fixes 6, 7, 9)", () => {
  it("merges the same person listed twice", () => {
    assert.equal(personKey("Lilia Agadganian, M.S., BCBA"), personKey("Lilia Agadganian"));
    const out = cleanLeadership([
      { name: "Lilia Agadganian", title: "Co-Founder", sourceUrl: "https://promiseaba.com/team" },
      { name: "Lilia Agadganian, BCBA", title: "Clinical Director", sourceUrl: "https://promiseaba.com/about" },
      { name: "Lilit Gevoglanian", title: "CEO", sourceUrl: "https://promiseaba.com/team" },
    ], "promiseaba.com");
    assert.equal(out.length, 2);
    assert.match(out[0].title, /Co-Founder.*Clinical Director/);
  });

  it("gives a contested title to the newer source and labels the older one", () => {
    const out = cleanLeadership([
      { name: "Jeffrey Marrs", title: "President and CEO", sourceUrl: "https://www.accoes.com/leadership" },
      { name: "Chuck Darway", title: "President", sourceUrl: "https://www.prnewswire.com/acco", asOf: "Oct 1, 2026" },
    ], "accoes.com");
    const marrs = out.find((l) => l.name === "Jeffrey Marrs")!;
    assert.equal(marrs.title, "CEO");
    assert.deepEqual(marrs.outdatedTitles, ["President"]);
    assert.equal(out.find((l) => l.name === "Chuck Darway")!.outdatedTitles, undefined);
  });

  it("marks names only a people directory gives as low confidence", () => {
    const [cfo] = cleanLeadership([{ name: "Pat Doe", title: "CFO", sourceUrl: "https://rocketreach.co/acco" }], "accoes.com");
    assert.equal(cfo.lowConfidence, true);
  });
});

describe("site crawl (fix 1) and products (fix 2)", () => {
  it("picks about, team, locations, services, press and acquisitions pages from the sitemap", () => {
    const xml = ["about-us/", "careers/", "our-team/", "locations/valencia/", "locations/", "services/adult-services/",
      "news/", "acquisitions/", "investment-criteria/", "blog/some-post/"]
      .map((p) => `<url><loc>https://mjw.example/${p}</loc></url>`).join("");
    const kinds = crawlTargets("<html></html>", "https://mjw.example/", `<urlset>${xml}</urlset>`).map((t) => t.kind);
    for (const k of ["about", "team", "locations", "services", "press", "acquisitions"]) assert.ok(kinds.includes(k), k);
    assert.ok(!crawlTargets("<html></html>", "https://mjw.example/", `<urlset>${xml}</urlset>`).some((t) => /careers|blog/.test(t.url)));
  });

  it("drops link titles and another firm's products", () => {
    assert.ok(isLinkTitle("Careers At MJW", "MJW Investments"));
    assert.ok(isLinkTitle("MJW Crunchbase Company Profile", "MJW Investments"));
    assert.ok(isLinkTitle("Services JPMS Brokerage", "MJW Investments"));
    assert.ok(!isLinkTitle("Student housing acquisitions", "MJW Investments"));
  });
});

describe("competitor search (fix 3)", () => {
  it("searches by role and region, never the company's own name", () => {
    const q = peerQueries("ACCO Engineered Systems", { role: "commercial mechanical contractor", headquarters: "Pasadena, CA", local: true });
    assert.deepEqual(q, ["commercial mechanical contractors Pasadena California", "largest commercial mechanical contractors in California"]);
    assert.ok(peerQueries("Promise ABA", { role: "ABA therapy provider", headquarters: "Burbank, CA", local: true }).every((x) => !/promise/i.test(x)));
    assert.deepEqual(peerQueries("X", {}), []);
    assert.deepEqual(regionOf("Santa Monica, CA 90401"), { city: "Santa Monica", state: "California" });
  });
});

describe("competitor agent claim-to-source check", () => {
  it("never reads a forum, and cites only pages that name the competitor", async () => {
    const { CompetitorAgent } = await import("../agents/competitor-agent/index.js");
    const searcher = {
      search: async () => [
        { title: "Largest mechanical contractors in California", url: "https://www.enr.com/toplists/ca", snippet: "EMCOR Group and Comfort Systems USA lead the list." },
        { title: "Who competes with ACCO?", url: "https://www.reddit.com/r/hvac/x", snippet: "Trane Technologies is the big one." },
      ],
    };
    const fetcher = { fetchText: async () => null };
    const r = await new CompetitorAgent(fetcher, searcher).run("ACCO Engineered Systems",
      { name: "ACCO Engineered Systems", anchor: {}, domain: "accoes.com" },
      { role: "commercial mechanical contractor", headquarters: "Pasadena, CA", local: true });
    assert.ok(r.competitors.every((c) => c.url === "https://www.enr.com/toplists/ca"));
    assert.ok(!r.competitors.some((c) => /trane/i.test(c.name)));
    assert.deepEqual(r.sources.map((s) => s.url), r.competitors.length ? ["https://www.enr.com/toplists/ca"] : []);
  });
});

describe("synthesis and consistency (fixes 4, 8, 10, 11)", () => {
  it("rejects generic risks and a summary that repeats the site's tagline", async () => {
    const { isGenericRisk, copiesDescription } = await import("../agents/synthesis-agent/index.js");
    assert.ok(isGenericRisk("ACCO faces competition from larger national firms."));
    assert.ok(isGenericRisk("MJW competes with larger, well-funded sponsors."));
    assert.ok(!isGenericRisk("The open NLRB case filed in Sept 2025 could delay ACCO's union contract talks."));
    const tagline = "Promise ABA provides compassionate, individualized ABA therapy for children and familes across Los Angeles.";
    assert.ok(copiesDescription("Promise ABA provides compassionate, individualized ABA therapy for children in LA.", tagline));
    assert.ok(!copiesDescription("A Burbank ABA provider founded in 2017, serving children and adults from two clinics.", tagline));
  });

  it("drops job listings from news and says up top when sanctions screening didn't run", async () => {
    const { applyCompanyConsistency } = await import("./consistency.js");
    const { ReportAgent } = await import("../agents/report-agent/index.js");
    const bundle = {
      query: "Promise ABA", generatedAt: "2026-10-22T00:00:00Z", leadership: [], products: [], funding: [], competitors: [],
      company: { name: "Promise ABA" }, sources: [], sanctionsUnavailable: true,
      news: [{ headline: "Analista de datos - Promise ABA - Empleo en Burbank", url: "https://www.indeed.com/viewjob?jk=1", date: "Oct 1, 2026" }],
    };
    applyCompanyConsistency(bundle as never, { name: "Promise ABA", anchor: {} });
    assert.equal(bundle.news.length, 0);
    const md = new ReportAgent().generate(bundle as never);
    assert.match(md.split("## Executive Summary")[0], /## Status\n\*\*Sanctions screening didn't run\.\*\*/);
  });
});
