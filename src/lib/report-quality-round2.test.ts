import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanProducts, isPersonName, parseCompanyQuery } from "./nlp.js";
import { findWebsite, readSiteRecord, subpageLinks } from "./entities/site-record.js";
import { mentionsAffiliation } from "./entities/affiliation.js";
import { companyCandidates, nearName, personCandidates } from "./candidates.js";
import { plausibleAnalysis } from "./consistency.js";
import { detectClosure } from "./closure.js";
import { htmlToFullText } from "./providers.js";
import { mentionsCompany } from "./news-noise.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

// Fixes from the Oct 21, 2026 retest (round 2).

// The shape of sdsdentistry.com's homepage: name in the title, address,
// phone and hours in the footer, the provider in the hero.
const SDS_HOME = `<html><head><title>Smile Design Studio </title></head><body>
<header><a href="index.html">HOME</a> <a href="about.html">ABOUT US</a> <a href="services01.html">Dental hygiene</a>
<a href="services02.html">Veneers</a> <a href="our-providers.html">OUR PROVIDERS</a> <a href="https://www.yelp.com/biz/x">Yelp</a></header>
<p>19524 W. Nordhoff Street Ste. 3B - Northridge, CA 91324</p><p>+1 (818) 477 3539</p>
<h2>General &amp; Cosmetic Dentistry By Dr. Jessica Lizana, DDS</h2>
<footer>OPENING HOURS Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
10:00 am- 7:00 pm, 10:00 am - 7:00 pm, Closed, 9:00 am - 6:00 pm, 9:00 am - 6:00 pm, 8:00 am - 3:00 pm, Closed</footer>
<p>Dr. Callahan made me feel relaxed.</p></body></html>`;

describe("website-first resolution (Fix 1)", () => {
  it("reads the business record from its own site, footer included", () => {
    const r = readSiteRecord(SDS_HOME);
    assert.equal(r.name, "Smile Design Studio");
    assert.equal(r.address, "19524 W. Nordhoff Street Ste. 3B, Northridge, CA 91324");
    assert.equal(r.city, "Northridge");
    assert.equal(r.state, "CA");
    assert.equal(r.phone, "(818) 477-3539");
    assert.match(r.hours ?? "", /^Monday 10:00 am - 7:00 pm; .*Wednesday Closed; .*Sunday Closed$/);
    // A full name with a credential; never a surname alone.
    assert.deepEqual(r.people, [{ name: "Jessica Lizana", title: "DDS" }]);
  });

  it("prefers the site's JSON-LD when it has one", () => {
    const r = readSiteRecord(`<script type="application/ld+json">{"@type":"Dentist","name":"Smile Design Studio",
      "telephone":"818-477-3539","address":{"streetAddress":"19524 Nordhoff St #3B","addressLocality":"Northridge","addressRegion":"CA","postalCode":"91324"}}</script>`);
    assert.equal(r.address, "19524 Nordhoff St #3B, Northridge, CA 91324");
    assert.equal(r.city, "Northridge");
    assert.equal(r.phone, "818-477-3539");
  });

  it("reads one page of each kind after the homepage, on the same site only", () => {
    assert.deepEqual(subpageLinks(SDS_HOME, "https://sdsdentistry.com/"), [
      "https://sdsdentistry.com/about.html",
      "https://sdsdentistry.com/services01.html",
      "https://sdsdentistry.com/our-providers.html",
    ]);
  });

  it("keeps the address that htmlToText would drop with the footer", () => {
    assert.match(htmlToFullText("<footer>Northridge, CA 91324</footer>"), /Northridge/);
  });

  it("finds a website in either field, with no rule that it resembles the name", () => {
    assert.deepEqual(parseCompanyQuery("sdsdentistry.com"),
      { name: "sdsdentistry.com", anchor: { website: "https://sdsdentistry.com", nameFromSite: true } });
    assert.deepEqual(parseCompanyQuery("Smile Design Studio · https://sdsdentistry.com/"),
      { name: "Smile Design Studio", anchor: { website: "https://sdsdentistry.com" } });
    assert.deepEqual(parseCompanyQuery("Smile Design Studio sdsdentistry.com"),
      { name: "Smile Design Studio", anchor: { website: "https://sdsdentistry.com" } });
    assert.deepEqual(parseCompanyQuery("Smile Design Studio · Northridge, CA"),
      { name: "Smile Design Studio", anchor: { location: "Northridge, CA" } });
    assert.equal(findWebsite("jane@acme.com"), undefined);
    assert.equal(findWebsite("U.S. Steel"), undefined);
  });

  it("says the site couldn't be read instead of reporting a namesake", () => {
    const md = new ReportAgent().generate({
      query: "x", generatedAt: "2026-10-21T00:00:00Z", leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
      company: { name: "Smile Design Studio", website: "https://sdsdentistry.com", siteUnreadable: "the site returned HTTP 403", thin: true, anchor: { website: "https://sdsdentistry.com" } },
    } as ResearchBundle);
    assert.match(md, /Couldn't read this website: the site returned HTTP 403/);
    assert.doesNotMatch(md, /Bethesda/);
  });
});

describe("recall without namesakes (Fix 2)", () => {
  it("counts employer variants as one (UCLA)", () => {
    assert.equal(mentionsAffiliation("Douglas Shapses | Real Estate Ofcr 4 | UCLA | 2022", "UCLA Health"), true);
    assert.equal(mentionsAffiliation("Real estate officer, University of California, Los Angeles", "UCLA"), true);
    assert.equal(mentionsAffiliation("Planner at UCLA", "University of California, Los Angeles"), true);
    assert.equal(mentionsAffiliation("Senior planner, City of West Hollywood", "UCLA"), false);
  });

  it("finds a person whose pages use a longer first name (Doug -> Douglas)", async () => {
    const searcher = {
      places: async () => [],
      // Exact phrase finds nothing; the unquoted search finds the payroll record.
      search: async (q: string) => q.startsWith('"') ? [] : [
        { title: "Douglas Shapses | Real Estate Ofcr 4 | UCLA | 2022", url: "https://openpayrolls.com/douglas-shapses", snippet: "Douglas Shapses worked as a Real Estate Ofcr 4 for UCLA" },
        { title: "Doug Shapses | Senior Planner | City of West Hollywood", url: "https://weho.org/x", snippet: "Doug Shapses, planner" },
      ],
    };
    const { candidates } = await personCandidates("Doug Shapses", "UCLA", searcher);
    assert.deepEqual(candidates.map((c) => c.subject), ["Doug Shapses · UCLA"]);
  });

  it("says a match couldn't be confirmed when people by that name exist", async () => {
    const r = await personCandidates("Doug Shapses", undefined, {
      places: async () => [],
      search: async () => [{ title: "Remembering a colleague", url: "https://x.example/a", snippet: "Doug Shapses spoke at the event" }],
    });
    assert.deepEqual(r, { candidates: [], namesFound: true });
  });
});

describe("name matching (Fix 3)", () => {
  it("doesn't read another company's phrase as the name (ORANGE JUICE equity)", () => {
    assert.equal(mentionsCompany("Sellers receive part of their consideration in ORANGE JUICE equity.", "Juice Equity"), false);
    assert.equal(mentionsCompany("Sellers get ORANGE JUICE. Equity partners agree.", "Juice Equity"), false);
    assert.equal(mentionsCompany("Juice Equity buys small businesses", "Juice Equity"), true);
    assert.equal(mentionsCompany("juice equity buys small businesses", "Juice Equity"), true);
    assert.equal(mentionsCompany("D&d HVAC Solutions | Arleta CA", "D&D HVAC"), true);
    assert.equal(mentionsCompany("U.S. Steel posts results", "U.S. Steel"), true);
  });
});

describe("analysis uses only the locked facts (Fix 3)", () => {
  const juice = {
    query: "Juice Equity", generatedAt: "2026-10-21T00:00:00Z",
    company: { name: "Juice Equity", website: "https://juiceequity.com", description: "Buys and runs small businesses." },
    leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
  } as unknown as ResearchBundle;
  const facts = [{ text: "What it does: Buys and runs small businesses." }, { text: "Funding: no public funding records found" }];

  it("drops items naming things no fact mentions, or funding the report says doesn't exist", () => {
    const kept = plausibleAnalysis([
      "A Bitcoin treasury exposes the balance sheet to crypto swings.",
      "The $40 million seed round funds faster acquisitions.",
      "Offering sellers holding-company equity could attract owners.",
      "Juice Equity's focus on small businesses keeps deal sizes manageable.",
    ], juice, facts);
    assert.deepEqual(kept, ["Juice Equity's focus on small businesses keeps deal sizes manageable."]);
  });
});

describe("candidates (Fix 4)", () => {
  it("lists near-name matches instead of picking one (ACCO Engineering)", async () => {
    assert.equal(nearName("ACCO Engineered Systems", "ACCO Engineering"), true);
    assert.equal(nearName("Acme Engineering", "ACCO Engineering"), false);
    const { candidates } = await companyCandidates("ACCO Engineering", {}, {
      places: async () => [
        { title: "ACCO Engineered Systems", address: "888 E Walnut St, Pasadena, CA 91101", website: "http://www.accoes.com/" },
        { title: "ACCO Engineering", address: "Plot 5, Lahore, Pakistan" },
      ],
      search: async () => [],
    });
    assert.deepEqual(candidates.map((c) => [c.subject, c.exact]), [
      ["ACCO Engineering · Lahore", true],
      ["ACCO Engineered Systems · https://accoes.com", false],
    ]);
  });

  it("keeps local listings past the first six (Smile Design Studio, Northridge)", async () => {
    const places = ["Duluth, GA", "Atlanta, GA", "Missouri City, TX", "Atlanta, GA 30329", "Alpharetta, GA", "Bethesda, MD", "Suwanee, GA", "Northridge, CA"]
      .map((city, i) => ({ title: "Smile Design Studio", address: `${i + 1} Main St, ${city}`, website: `https://sds${i}.example.com/` }));
    const { candidates } = await companyCandidates("Smile Design Studio", {}, { places: async () => places, search: async () => [] });
    assert.ok(candidates.some((c) => c.description.includes("Northridge")));
  });
});

describe("extraction (Fix 5)", () => {
  it("keeps offerings, drops page titles, dates, fragments and the company's name (MJW)", () => {
    const names = cleanProducts([
      { name: "Crunchbase Company Profile" }, { name: "Funding MJW Investments" }, { name: "May" }, { name: "MJW Investments Acquires" },
      { name: "Off" }, { name: "Market" }, { name: "Multifamily Acquisitions" }, { name: "Orthodontics" }, { name: "Teeth whitening" },
    ], "MJW Investments").map((p) => p.name);
    assert.deepEqual(names, ["Multifamily Acquisitions", "Orthodontics", "Teeth whitening"]);
  });

  it("requires a full person name that isn't the company's (Alan Health)", () => {
    assert.equal(isPersonName("Alan", "Alan Health Technologies"), false);
    assert.equal(isPersonName("Alan Health", "Alan Health Technologies"), false);
    assert.equal(isPersonName("Dr. Jessica Lizana", "Smile Design Studio"), true);
    assert.equal(isPersonName("Jean-Charles Samuelian", "Alan Health Technologies"), true);
  });

  it("labels an investment firm's offerings and says when none are listed", () => {
    const md = new ReportAgent().generate({
      query: "x", generatedAt: "2026-10-21T00:00:00Z", leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
      company: { name: "MJW Investments" },
    } as unknown as ResearchBundle);
    assert.match(md, /## Services \/ focus areas\n_No products or services listed\._/);
  });

  it("quotes a closure on word boundaries and says when one community post is the only source", () => {
    const text = "Posted in Ventura Locals: The Fosters Freeze store on Main St in Ventura is permanently closed as of this week.";
    const c = detectClosure([{ text, url: "https://www.facebook.com/groups/ventura/posts/1" }], "Foster's Freeze", "Ventura");
    assert.ok(c);
    assert.match(c!.evidence, /^…?[A-Z]|^Posted/);
    assert.doesNotMatch(c!.evidence, /^rs Freeze/);
    assert.equal(c!.sources, 1);
    assert.equal(c!.communityOnly, true);
    const md = new ReportAgent().generate({
      query: "x", generatedAt: "2026-10-21T00:00:00Z", leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
      company: { name: "Foster's Freeze", closure: c },
    } as unknown as ResearchBundle);
    assert.match(md, /Reported closed in a community post; not otherwise confirmed/);
  });
});
