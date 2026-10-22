import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DirectFetchProvider, htmlToFullText } from "./providers.js";
import { isCompanyName } from "../agents/competitor-agent/index.js";
import { cleanFunding } from "../agents/corporate-agent/index.js";
import { factsRestated } from "../agents/synthesis-agent/index.js";
import { contractCeilings } from "./contract-ceilings.js";
import { CourtListenerAgent } from "../agents/courtlistener-agent/index.js";
import { evaluatePosture } from "../agents/domain-posture-agent/index.js";
import { sendingDomain, WebsiteAgent } from "../agents/website-agent/index.js";
import { titleNear } from "./leadership.js";
import { nameVariants } from "../agents/public-filings-agent/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const withFetch = async (impl: (url: string) => Response | Promise<Response>, fn: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => impl(String(input))) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = original; }
};
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

describe("launch round 3-4", () => {
  it("24: reads a site that refuses us from its Internet Archive copy, only when asked", async () => {
    const seen: string[] = [];
    await withFetch((url) => {
      seen.push(url);
      return url.includes("web.archive.org") ? html("<title>Crumbl</title><p>Crumbl cookies, Lindon, Utah.</p>") : html("denied", 403);
    }, async () => {
      const p = new DirectFetchProvider();
      const plain = await p.fetchPage(`https://crumbl-test-${Date.now()}.example/`);
      assert.equal(plain.html, null);
      const page = await p.fetchPage(`https://crumbl-test2-${Date.now()}.example/`, true);
      assert.equal(page.via, "archived");
      assert.match(page.html ?? "", /Lindon/);
    });
    assert.ok(seen.some((u) => /web\.archive\.org\/web\/\d{8}id_\//.test(u)));
  });

  it("25: several listings linking to one site make it a chain; no store becomes the HQ", async () => {
    const searcher = {
      search: async () => [],
      places: async () => [
        { title: "Crumbl - Hilton Head", address: "1 Main St, Hilton Head Island, SC 29928", website: "https://crumblcookies.com/schiltonhead" },
        { title: "Crumbl - Lindon", address: "2 State St, Lindon, UT 84042", website: "https://crumblcookies.com/utlindon" },
      ],
    };
    await withFetch(() => html("blocked", 403), async () => {
      const r = await new WebsiteAgent(new DirectFetchProvider(), searcher).run("Crumbl", { website: `https://crumbl-${Date.now()}.example` });
      assert.equal(r.company.chain, undefined, "different domain: no listing matched");
    });
    await withFetch(() => html("blocked", 403), async () => {
      const r = await new WebsiteAgent(new DirectFetchProvider(), searcher).run("Crumbl", { website: "https://crumblcookies.com" });
      assert.equal(r.company.chain, true);
      assert.notEqual(r.company.headquarters, "Hilton Head Island, SC");
      assert.equal(r.company.anchor?.location, undefined);
      assert.equal(r.company.address, undefined);
    });
  });

  it("26: competitor names must be companies", () => {
    for (const bad of ["Largest Capital Investment", "Shapiro Administration", "U.S", "the robotics market"]) assert.ok(!isCompanyName(bad, "Gecko Robotics"), bad);
    for (const good of ["ANYbotics", "Invert Robotics", "Eddyfi", "Insomnia Cookies", "Nothing Bundt Cakes", "Great American Cookies"]) assert.ok(isCompanyName(good, "Gecko Robotics"), good);
  });

  it("27: funding drops prizes, dedupes a round, and runs newest first", () => {
    const f = cleanFunding([
      { round: "Seed", amount: "$10K", date: "2016" },
      { round: "Series A", amount: "$7M", date: "2018-05-01" },
      { round: "Series A round", amount: "$7.0M" },
      { round: "Series C", amount: "$73M", date: "2022-03-01" },
      { round: "Series C extension", amount: "$100M", date: "Dec 2023" },
      { round: "Series D", amount: "$125M", date: "Jun 2025" },
    ]);
    assert.deepEqual(f.map((x) => x.round), ["Series D", "Series C extension", "Series C", "Series A"]);
    assert.deepEqual(nameVariants("Gecko Robotics"), ["Gecko Robotics", "Gecko Robotics, Inc.", "Gecko Robotics LLC"]);
  });

  it("28: a bare sentence is cited to the facts it restates; ceilings sit next to obligations", () => {
    const facts = [{ text: "Federal award: $3,400,000, Department of the Navy" }, { text: "Leadership: Jake Loosararian, CEO" }];
    assert.deepEqual(factsRestated("Navy work is concentrated: about $3,400,000 obligated by the Department of the Navy.", facts), [1]);
    assert.deepEqual(factsRestated("Strong brand.", facts), []);
    const c = contractCeilings(
      [{ awardingAgency: "Department of the Navy", amount: "$3,400,000" }],
      [{ headline: "Gecko Robotics wins $300M Navy and GSA contract", url: "https://news.example/a", date: "Oct 20, 2026" }]);
    assert.equal(c[0].agency, "Navy");
    assert.equal(c[0].ceiling, 300e6);
    assert.equal(c[0].obligated, 3.4e6);
  });

  it("30: CourtListener reads every page up to the cap", async () => {
    let calls = 0;
    await withFetch((url) => {
      calls++;
      const page = calls;
      return new Response(JSON.stringify({
        results: [{ caseName: `Case ${page} v. Crumbl LLC`, docket_absolute_url: `/docket/${page}/` }],
        next: page < 5 ? `${url}&page=${page + 1}` : null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }, async () => {
      const r = await new CourtListenerAgent().run('"Crumbl"', 3);
      assert.equal(r.records.length, 3);
    });
  });

  it("31: checks the domain the company sends email from", () => {
    assert.equal(sendingDomain(['<a href="mailto:press@crumbl.com">press@crumbl.com</a> support@shopify.com logo@2x.png'], "https://crumblcookies.com"), "crumbl.com");
    const p = evaluatePosture({ domain: "crumblcookies.com", mx: [], txt: [], dmarc: [], sending: { domain: "crumbl.com", txt: ["v=spf1 include:_spf.google.com -all"], dmarc: ["v=DMARC1; p=reject"] } });
    const siteSpf = p.checks.find((c) => c.label === "SPF")!;
    assert.equal(siteSpf.severity, "low");
    assert.match(siteSpf.detail, /comes from crumbl\.com/);
    assert.equal(p.checks.find((c) => c.label === "DMARC (email domain crumbl.com)")?.status, "ok");
  });

  it("32: trademark marks, missing titles and pre-registration snapshots", () => {
    assert.equal(htmlToFullText("<p>Cantileve<span>r</span><sup>®</sup> crawler</p>"), "Cantilever® crawler");
    assert.equal(titleNear("Jake Loosararian", ["Gecko Robotics co-founder and CEO Jake Loosararian said..."]), "Co-Founder and CEO");
    assert.equal(titleNear("Troy Demmer", ["Troy Demmer, President of Gecko Robotics"]), "President");
    const md = new ReportAgent().generate({
      query: "Gecko", generatedAt: "", leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
      company: { name: "Gecko Robotics" },
      webArchive: { snapshotCount: 900, firstSnapshot: { timestamp: "20010402000000", url: "https://web.archive.org/web/20010402000000/geckorobotics.com" } },
      domainPosture: { domain: "geckorobotics.com", checkedAt: "", registeredAt: "2013-06-11T00:00:00Z", checks: [] },
    } as unknown as ResearchBundle);
    assert.match(md, /registered on 2013-06-11; snapshots before that date likely belong to a previous owner/);
  });
});

describe("analysis model (Oct 22)", () => {
  it("sends analysis calls to Gemini 2.5 Flash first, ordinary extraction to the default chain", async () => {
    const { extractAnalysis, extractStructured, RisksOpportunitiesSchema } = await import("./llm.js");
    const bodies: { models: string[] }[] = [];
    const prev = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      await withFetch(async (url) => {
        if (url.includes("openrouter.ai")) return new Response(JSON.stringify({ choices: [{ message: { content: '{"risks":[],"opportunities":[]}' } }] }), { status: 200 });
        return new Response("", { status: 404 });
      }, async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).includes("openrouter.ai")) bodies.push(JSON.parse(String(init?.body)));
          return original(input, init);
        }) as typeof fetch;
        try {
          await extractAnalysis(`analysis ${Date.now()}`, "facts", RisksOpportunitiesSchema);
          await extractStructured(`plain ${Date.now()}`, "text", RisksOpportunitiesSchema);
        } finally { globalThis.fetch = original; }
      });
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prev;
    }
    assert.equal(bodies[0].models[0], "google/gemini-2.5-flash");
    assert.equal(bodies[0].models.length, 3);
    assert.equal(bodies[1].models[0], "google/gemma-4-31b-it");
  });
});
