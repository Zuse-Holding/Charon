import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anchorCurrentRole, otherCeoOf, verifyEducation, within, withoutCeo } from "./person-sources.js";
import { applyPersonConsistency } from "./consistency.js";
import { isPlaceNamesake, namesItself } from "./news-noise.js";
import { orgFromTitle } from "./candidates.js";
import { reconcilePersonCoverage } from "../agents/orchestrator/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { PersonProfile, PersonResearchBundle } from "../types/research.js";

const personOf = (over: Partial<PersonResearchBundle>): PersonResearchBundle => ({
  query: "Jane Doe", generatedAt: "2026-10-28T00:00:00Z", person: { name: "Jane Doe" }, careerHistory: [], news: [], sources: [], ...over,
});

describe("round twenty-three: person search fixes from Oct 28", () => {
  it("an optional step that runs out of time gives its fallback, not a lost report", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 200));
    assert.equal(await within(slow, 20, "fallback"), "fallback");
    assert.equal(await within(Promise.resolve("on time"), 1000, "fallback"), "on time");
    assert.equal(await within(Promise.reject(new Error("boom")), 1000, "fallback"), "fallback");
    assert.equal(await within(Promise.resolve("x"), 0, "no time left"), "no time left");
  });

  it("an incomplete report says so up top", () => {
    const md = new ReportAgent().generatePerson(personOf({ incomplete: true }));
    assert.match(md, /## Status\n\*\*Results are incomplete\.\*\*/);
    assert.doesNotMatch(new ReportAgent().generatePerson(personOf({})), /## Status/);
  });

  it("a source marked Results shows at least one finding", () => {
    const bundle = personOf({
      person: { name: "Michael McCann", affiliation: "Limbach Holdings" },
      coverage: [
        { id: "opencorporates", name: "OpenCorporates", jurisdiction: "Global", category: "corporate filings", status: "results", query: "Michael McCann", count: 1, section: "Corporate Affiliations" },
        { id: "littlesis", name: "LittleSis", jurisdiction: "US", category: "relationships", status: "results", query: "Michael McCann", count: 3, section: "Public Records" },
      ],
      powerMapConnections: [{ name: "Michael McCann", url: "https://littlesis.org/a", blurb: "CEO of Limbach" }],
    });
    reconcilePersonCoverage(bundle);
    assert.equal(bundle.coverage![0].status, "no_results");
    assert.match(bundle.coverage![0].reason!, /1 record found under this name, none tied to Limbach Holdings/);
    assert.equal(bundle.coverage![1].count, 1);
  });

  it("the picked company sets the current role over a board seat elsewhere", () => {
    const person: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Non-Executive Chair", currentCompany: "WM" };
    const career = [
      { title: "Non-Executive Chair", company: "WM", start: "2020" },
      { title: "Chairman, President and CEO", company: "Graybar Electric Company", start: "Jun 2012" },
      { title: "EVP and COO", company: "Graybar Electric Company", start: "2010", end: "2012" },
    ];
    assert.match(anchorCurrentRole(person, career, "Graybar")!, /Graybar/);
    assert.deepEqual([person.currentRole, person.currentCompany], ["Chairman, President and CEO", "Graybar Electric Company"]);

    const boardOnly: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Non-Executive Chair", currentCompany: "WM" };
    anchorCurrentRole(boardOnly, [], "Graybar");
    assert.deepEqual([boardOnly.currentRole, boardOnly.currentCompany], [undefined, "Graybar"]);

    const already: PersonProfile = { name: "Michael McCann", currentRole: "CEO", currentCompany: "Limbach Holdings, Inc." };
    assert.equal(anchorCurrentRole(already, [], "Limbach Holdings"), undefined);
  });

  it("education only from a source tied to the person and company, in the source's wording", () => {
    const tied = ["Jake Loosararian co-founded Gecko Robotics in 2013. He holds a B.S. in Electrical Engineering from Grove City College."];
    assert.equal(
      verifyEducation("GCSEs and A-levels, Edwards School; B.A.Sc., Grove City College", tied, "Jake Loosararian"),
      "Grove City College",
    );
    assert.equal(
      verifyEducation("B.S. in Electrical Engineering, Grove City College", tied, "Jake Loosararian"),
      "B.S. in Electrical Engineering, Grove City College",
    );
    assert.equal(verifyEducation("MBA, Drexel University", tied, "Jake Loosararian"), undefined);
  });

  it("a CEO title conflicts with someone else named as the organization's CEO", () => {
    const texts = ["Homeboy Industries CEO Thomas Vozzo said the program grew.", "Father Gregory Boyle founded Homeboy Industries in 1988."];
    assert.equal(otherCeoOf(texts, "Homeboy Industries", "Gregory Boyle"), "Thomas Vozzo");
    assert.equal(otherCeoOf(["Gregory Boyle, CEO of Homeboy Industries"], "Homeboy Industries", "Gregory Boyle"), undefined);
    assert.equal(withoutCeo("Founder and CEO"), "Founder");
    assert.equal(withoutCeo("CEO"), "");
    assert.equal(withoutCeo("Founder and Executive Director"), "Founder and Executive Director");
  });

  it("one affiliation row per organization, with no conflicting CEO title", () => {
    const bundle = personOf({
      person: { name: "Gregory Boyle", affiliation: "Homeboy Industries" },
      officerConflicts: [{ org: "Homeboy Industries", ceo: "Thomas Vozzo" }],
      corporateAffiliations: [
        { companyName: "HOMEBOY INDUSTRIES", position: "Founder and CEO" },
        { companyName: "Homeboy Industries", position: "Founder and Executive Director" },
        { companyName: "Homeboy Industries", position: "Founder" },
        { companyName: "HOMEBOY INDUSTRIES", position: "Executive Director" },
      ],
    });
    applyPersonConsistency(bundle);
    assert.deepEqual(bundle.corporateAffiliations?.map((a) => a.position), ["Founder and Executive Director"]);
  });

  it("an open record beats an ended one, then the newest start", () => {
    const bundle = personOf({
      person: { name: "Jane Doe", affiliation: "Acme" },
      corporateAffiliations: [
        { companyName: "Acme", position: "Director", startDate: "2010-01-01", endDate: "2015-01-01" },
        { companyName: "ACME", position: "President", startDate: "2018-01-01" },
        { companyName: "Acme", position: "Secretary", startDate: "2016-01-01" },
      ],
    });
    applyPersonConsistency(bundle);
    assert.deepEqual(bundle.corporateAffiliations?.map((a) => a.position), ["President"]);
  });

  it("Patagonia the region stays out of the company feed", () => {
    assert.equal(isPlaceNamesake("Patagonia Is Burning", "Fires spread through the Andes.", "Patagonia"), true);
    assert.equal(isPlaceNamesake("Patagonia wildfires spread as Milei austerity bites", "", "Patagonia"), true);
    assert.equal(namesItself("Wildfires rage across Argentina’s Patagonia", "Patagonia"), false);
    assert.equal(isPlaceNamesake("Patagonia sues over wildfire-damaged public lands", "The outdoor apparel company filed suit.", "Patagonia"), false);
    assert.equal(orgFromTitle("Ryan Gellert - Patagonia.", "Ryan Gellert"), "Patagonia");
  });
});
