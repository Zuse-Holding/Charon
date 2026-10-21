import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanProducts, parseCompanyQuery } from "./nlp.js";
import { isUsableHeadline, mentionsCompany, mentionsPerson } from "./news-noise.js";
import { detectClosure } from "./closure.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

// Fixes from the Oct 20, 2026 report quality check.

describe("cleanProducts", () => {
  const names = (list: { name: string }[]) => list.map((p) => p.name);

  it("drops fragments, repeated words and company-name echoes (ACCO, MJW, D&D HVAC)", () => {
    assert.deepEqual(names(cleanProducts([
      { name: "engineering engineering" }, { name: "HVAC Design" }, { name: "for" }, { name: "and" },
      { name: "ACCO Engineering" }, { name: "Engineering" }, { name: "hvac design" }, { name: "**Duct Cleaning** —" },
    ], "ACCO Engineering")), ["HVAC Design", "Duct Cleaning"]);
  });

  it("keeps only products the source text supports", () => {
    assert.deepEqual(names(cleanProducts([{ name: "Furnace Repair" }, { name: "Solar Panels" }],
      "D&D HVAC", "We offer furnace repair and AC installation in Arleta.")), ["Furnace Repair"]);
  });
});

describe("news items", () => {
  it("rejects a bare date or a two-word title (Saumyya Bhatnagar)", () => {
    assert.equal(isUsableHeadline("February 6, 2026"), false);
    assert.equal(isUsableHeadline("2026-02-06"), false);
    assert.equal(isUsableHeadline("Press release"), false);
    assert.equal(isUsableHeadline("Havn Health raises seed round"), true);
  });

  it("matches a company by whole phrase, ignoring apostrophes and legal suffix", () => {
    assert.equal(mentionsCompany("Foster's Freeze in Ventura has closed", "Fosters Freeze"), true);
    assert.equal(mentionsCompany("Juice Equity LLC files annual report", "Juice Equity, LLC"), true);
    assert.equal(mentionsCompany("Fresh juice and equity markets", "Juice Equity"), false);
  });

  it("matches a person by surname plus a first-name variant", () => {
    assert.equal(mentionsPerson("Saumya Bhatnagar-Knox joins board", "Saumyya Bhatnagar"), true);
    assert.equal(mentionsPerson("Doug Shapses, UCLA", "Doug Shapses"), true);
    assert.equal(mentionsPerson("Mark Shapses speaks", "Doug Shapses"), false);
  });
});

describe("parseCompanyQuery", () => {
  it("splits a location anchor", () => {
    assert.deepEqual(parseCompanyQuery("Smile Design Studio · Northridge"),
      { name: "Smile Design Studio", anchor: { location: "Northridge" } });
  });
  it("splits a website anchor into an origin", () => {
    assert.deepEqual(parseCompanyQuery("Juice Equity · juiceequity.com/about"),
      { name: "Juice Equity", anchor: { website: "https://juiceequity.com" } });
  });
  it("leaves a plain name alone", () => {
    assert.deepEqual(parseCompanyQuery("D&D HVAC"), { name: "D&D HVAC", anchor: {} });
  });
});

describe("detectClosure", () => {
  const item = (text: string) => ({ text, url: "https://example.com/x" });

  it("needs a closure phrase that names the business and the city", () => {
    assert.ok(detectClosure([item("Foster's Freeze Ventura is permanently closed.")], "Foster's Freeze", "Ventura"));
    assert.equal(detectClosure([item("Foster's Freeze Fresno is permanently closed.")], "Foster's Freeze", "Ventura"), undefined);
  });
  it("ignores 'closed' in the deal sense", () => {
    assert.equal(detectClosure([item("Juice Equity closed a $5M fund.")], "Juice Equity"), undefined);
  });
});

describe("company report rendering", () => {
  const base = {
    query: "X", generatedAt: "2026-10-20T12:00:00.000Z", leadership: [], products: [], news: [],
    funding: [], competitors: [], sources: [],
  };

  it("puts a closed status first and marks an unverified searched location", () => {
    const md = new ReportAgent().generate({
      ...base,
      company: {
        name: "Foster's Freeze", headquarters: "Ventura", headquartersUnverified: true,
        anchor: { location: "Ventura" }, closure: { evidence: "permanently closed", url: "https://example.com/c", sources: 1, communityOnly: false },
      },
    } as ResearchBundle);
    const sections = md.split("\n").filter((l) => l.startsWith("## "));
    assert.equal(sections[0], "## Status");
    assert.match(md, /\*\*Headquarters:\*\* Ventura \(location from your search, not verified\)/);
    assert.match(md, /\*\*Matched on:\*\* Ventura \(from your search\)/);
  });

  it("says screening was unavailable instead of showing nothing", () => {
    const md = new ReportAgent().generate({ ...base, company: { name: "Acme" }, sanctionsUnavailable: true } as ResearchBundle);
    assert.match(md, /## Public Records[\s\S]*Screening unavailable/);
  });
});

// --- Second pass: candidates, consistency, plausibility, cache ---
import { companyCandidates, orgFromTitle, personCandidates } from "./candidates.js";
import { applyCompanyConsistency, parseMoney, plausibleAnalysis } from "./consistency.js";
import { tiedToSubject } from "./entities/subject.js";
import { isLocationOnly } from "./nlp.js";
import { SerperSearchProvider } from "./providers.js";
import { withCostTracking } from "./cost-tracking.js";

const fakeSearcher = (places: { title: string; address?: string; website?: string }[], results: { title: string; url: string; snippet?: string }[]) => ({
  places: async () => places,
  search: async () => results,
});

describe("company candidates", () => {
  it("lists each same-named business once, by listing or by site (Smile Design Studio)", async () => {
    const { candidates } = await companyCandidates("Smile Design Studio", {}, fakeSearcher(
      [
        { title: "Smile Design Studio", address: "8501 Reseda Blvd, Northridge, CA 91324", website: "https://smiledesignnorthridge.com/" },
        { title: "Smile Design Studio", address: "10215 Fernwood Rd, Bethesda, MD 20817" },
      ],
      [
        { title: "Smile Design Studio | Cosmetic Dentist NYC", url: "https://smiledesignnyc.com/" },
        { title: "Smile Design Studio - Yelp", url: "https://www.yelp.com/biz/x" },
        { title: "Smile Design Studio Northridge", url: "https://smiledesignnorthridge.com/about" },
      ],
    ));
    assert.deepEqual(candidates.map((c) => c.subject), [
      "Smile Design Studio · https://smiledesignnorthridge.com",
      "Smile Design Studio · Bethesda",
      "Smile Design Studio · smiledesignnyc.com",
    ]);
  });

  it("offers a person search when a 'company' is a person's name (Doug Shapses UCLA)", async () => {
    const r = await companyCandidates("Doug Shapses UCLA", {}, fakeSearcher([], [{ title: "Doug Shapses - UCLA Health", url: "https://uclahealth.org/x" }]));
    assert.deepEqual(r, { candidates: [], suggestType: "person" });
  });
});

describe("person candidates", () => {
  it("reads the organization from a profile title", () => {
    assert.equal(orgFromTitle("Doug Shapses - UCLA Health | LinkedIn", "Doug Shapses"), "UCLA Health");
    assert.equal(orgFromTitle("Doug Shapses | Senior Planner | City of West Hollywood", "Doug Shapses"), "City of West Hollywood");
  });

  it("lists same-named people separately, never merged (Nick Olmos)", async () => {
    const { candidates } = await personCandidates("Nick Olmos", undefined, fakeSearcher([], [
      { title: "Nick Olmos - Professor - Ventura College", url: "https://a.edu/x", snippet: "Nick Olmos teaches" },
      { title: "Nick Olmos - Zuse Holdings | LinkedIn", url: "https://linkedin.com/in/x", snippet: "Nick Olmos founder" },
      { title: "Nick Olmos - Zuse Holdings", url: "https://zuse.example/x", snippet: "Nick Olmos founder" },
    ]));
    assert.deepEqual(candidates.map((c) => c.subject), ["Nick Olmos · Ventura College", "Nick Olmos · Zuse Holdings"]);
  });

  it("with an anchor, only a page naming it counts, and the anchor is what's researched (round 2)", async () => {
    const r = await personCandidates("Nick Olmos", "Santa Paula", fakeSearcher([], [
      { title: "Nick Olmos - Professor - Ventura College", url: "https://a.edu/x", snippet: "Nick Olmos teaches" },
    ]));
    assert.deepEqual(r, { candidates: [], namesFound: true });
  });

  it("treats a city or state alone as not enough", () => {
    assert.equal(isLocationOnly("Santa Paula, CA"), true);
    assert.equal(isLocationOnly("UCLA Health"), false);
  });
});

describe("consistency and plausibility", () => {
  const bundle = (over: Partial<ResearchBundle> = {}) => ({
    query: "Alan Health Technologies", generatedAt: "2026-10-20T00:00:00Z",
    company: { name: "Alan Health Technologies" }, leadership: [], products: [], news: [],
    funding: [], competitors: [], sources: [], ...over,
  }) as ResearchBundle;

  it("parses money figures", () => {
    assert.deepEqual(parseMoney("a $8.9B Series G and $500M and $12,000"), [8.9e9, 500e6, 12000]);
  });

  it("drops analysis citing a figure that isn't in the facts (Alan Health's $8.9B)", () => {
    const kept = plausibleAnalysis([
      "The $8.9B Series G valuation gives it room to expand.",
      "Its pharmacy partnerships widen distribution.",
    ], bundle());
    assert.deepEqual(kept, ["Its pharmacy partnerships widen distribution."]);
  });

  it("drops out-of-scale funding for a local business and news from another city", () => {
    const b = bundle({
      company: { name: "Promise ABA", anchor: { location: "Ventura" } },
      funding: [{ round: "Series D", amount: "$250M" }, { round: "Seed", amount: "$1.5M" }],
      news: [
        { headline: "Promise ABA opens Ventura clinic", url: "https://news.example/a" },
        { headline: "Promise ABA expands in Texas", url: "https://news.example/b" },
      ],
    });
    applyCompanyConsistency(b, { name: "Promise ABA", anchor: { location: "Ventura" } });
    assert.deepEqual(b.funding.map((f) => f.amount), ["$1.5M"]);
    assert.deepEqual(b.news.map((n) => n.headline), ["Promise ABA opens Ventura clinic"]);
  });

  it("ties a source by domain or by name", () => {
    const rec = { name: "Juice Equity", anchor: {}, domain: "juiceequity.com" };
    assert.equal(tiedToSubject("Team", "https://www.juiceequity.com/team", rec), true);
    assert.equal(tiedToSubject("Juice Equity raises fund", "https://news.example/x", rec), true);
    assert.equal(tiedToSubject("Fresh juice stand", "https://news.example/y", rec), false);
  });
});

describe("company report, second pass", () => {
  const base = {
    query: "X", generatedAt: "2026-10-20T12:00:00.000Z", leadership: [], products: [], news: [],
    funding: [], competitors: [], sources: [],
  };

  it("writes an honest thin report for an unlisted business (Zuse Holdings)", () => {
    const md = new ReportAgent().generate({ ...base, company: { name: "Zuse Holdings", thin: true, anchor: { unlisted: true } } } as ResearchBundle);
    assert.match(md, /Little public presence/);
    assert.match(md, /Other companies share this name; they're not included/);
    assert.doesNotMatch(md, /Matched on/);
  });

  it("labels a franchise location and links every leader and product to a source", () => {
    const md = new ReportAgent().generate({
      ...base,
      company: { name: "Foster's Freeze", brandLevel: true, anchor: { location: "Ventura" }, description: "Soft-serve chain." },
      leadership: [{ name: "Jane Doe", title: "CEO", sourceUrl: "https://fostersfreeze.com/about" }],
      products: [{ name: "Twist Cone", sourceUrl: "https://fostersfreeze.com/menu" }],
    } as ResearchBundle);
    assert.match(md, /\*\*Location:\*\* Ventura — franchise location of Foster's Freeze/);
    assert.match(md, /Brand-level: this describes Foster's Freeze overall, not the Ventura location/);
    assert.match(md, /\*\*Jane Doe\*\* — CEO \(\[source\]\(https:\/\/fostersfreeze\.com\/about\)\)/);
    assert.match(md, /\*\*Twist Cone\*\* \(\[source\]\(https:\/\/fostersfreeze\.com\/menu\)\)/);
    assert.match(md, /No public funding records found/);
  });
});

describe("source cache", () => {
  it("serves a repeat search from cache, counts only real calls, and bypasses it on refresh", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ organic: [{ title: "T", link: "https://a.example/" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const s = new SerperSearchProvider("test-key");
      const q = `cache test ${Date.now()}`;
      const first = await withCostTracking(async () => { await s.search(q); await s.search(q); });
      assert.equal(calls, 1);
      assert.equal(first.searchCalls, 1);
      await withCostTracking(async () => { await s.search(q); }, { refresh: true });
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
