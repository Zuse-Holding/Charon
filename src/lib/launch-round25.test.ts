import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { settleTitles } from "./person-sources.js";
import { applyPersonConsistency } from "./consistency.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { CareerEntry, PersonProfile, PersonResearchBundle } from "../types/research.js";

const report = (over: Partial<PersonResearchBundle>) => new ReportAgent().generatePerson({
  query: "x", generatedAt: "2026-10-29T00:00:00Z", person: { name: "x" }, careerHistory: [], news: [],
  sources: [{ url: "https://example.com/bio", title: "Bio", retrievedAt: "2026-10-29", usedFor: ["bio", "corporate-affiliations"] }],
  ...over,
});

describe("round twenty-five: the CEO title survives (Oct 28 retest)", () => {
  it("Gellert: a predecessor named as CEO doesn't take his title", () => {
    const person: PersonProfile = { name: "Ryan Gellert", currentRole: "CEO", currentCompany: "Patagonia",
      summary: "Ryan Gellert has been CEO of Patagonia since September 2020." };
    const career: CareerEntry[] = [
      { title: "CEO", company: "Patagonia", start: "Sep 2020", current: true },
      { title: "General Manager, EMEA", company: "Patagonia", start: "2014", end: "2020" },
      { title: "President", company: "Black Diamond Equipment", start: "2012", end: "2014" },
    ];
    const snippets = [
      "Former Patagonia CEO Rose Marcario stepped down in June 2020.",
      "Patagonia CEO Rose Marcario to step down after 12 years.",
      "Rose Marcario, Patagonia’s CEO until 2020, now advises startups.",
      "Patagonia CEO Ryan Gellert on the company’s new owner, the Earth.",
    ];
    const settled = settleTitles(person, career, ["Patagonia"], { snippets, summary: person.summary });
    assert.deepEqual(settled.officerConflicts, []);
    assert.deepEqual([person.currentRole, person.currentCompany], ["CEO", "Patagonia"]);
    assert.deepEqual(settled.careerHistory[0], { title: "CEO", company: "Patagonia", start: "Sep 2020", current: true });

    const md = report({
      person, careerHistory: settled.careerHistory,
      corporateAffiliations: [{ companyName: "BLACK DIAMOND EQUIPMENT, LTD.", position: "President", startDate: "2012" }],
    });
    assert.match(md, /## Current Role\n- \*\*Role:\*\* CEO\n- \*\*Company:\*\* Patagonia/);
    assert.match(md, /## Career History\n- CEO at Patagonia _\(since Sep 2020\)_/);
    assert.match(md, /BLACK DIAMOND EQUIPMENT, LTD\.\*\* — President _\(2012 – 2014\)_/);
    assert.doesNotMatch(md, /since 2012/);
  });

  it("Mazzarella: Chairman, President and CEO", () => {
    const person: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Chairman, President and CEO", currentCompany: "Graybar" };
    const settled = settleTitles(person, [
      { title: "Chairman, President and CEO", company: "Graybar", start: "Jun 2012" },
      { title: "EVP and COO", company: "Graybar", start: "2010", end: "2012" },
    ], ["Graybar"], {
      snippets: [
        "Graybar CEO Kathleen Mazzarella was named non-executive chair of WM.",
        "Former Graybar CEO Robert Reynolds retired in 2012.",
        "The board named its new president and CEO of Graybar Electric.",
      ],
    });
    assert.deepEqual(settled.officerConflicts, []);
    assert.equal(person.currentRole, "Chairman, President and CEO");
    assert.equal(settled.careerHistory[0].title, "Chairman, President and CEO");
    assert.equal(settled.careerHistory[0].start, "Jun 2012");
  });

  it("Loosararian: Co-Founder and CEO", () => {
    const person: PersonProfile = { name: "Jake Loosararian", currentRole: "Co-Founder", currentCompany: "Gecko Robotics" };
    const settled = settleTitles(person, [{ title: "Co-Founder and CEO", company: "Gecko Robotics", start: "2013" }], ["Gecko Robotics"], {
      snippets: ["Gecko Robotics CEO and co-founder Jake Loosararian spoke at the summit."],
    });
    assert.deepEqual(settled.officerConflicts, []);
    assert.equal(person.currentRole, "Co-Founder and CEO");
    assert.deepEqual(settled.careerHistory[0], { title: "Co-Founder and CEO", company: "Gecko Robotics", start: "2013", current: true });
  });

  it("Boyle: Executive Director, no CEO title, with Thomas Vozzo named CEO", () => {
    const person: PersonProfile = { name: "Gregory Boyle", currentRole: "Executive Director", currentCompany: "Homeboy Industries" };
    const settled = settleTitles(person, [
      { title: "Founder and CEO", company: "Homeboy Industries", start: "1988" },
      { title: "Executive Director", company: "Homeboy Industries", start: "1988" },
    ], ["Homeboy Industries"], {
      snippets: [
        "Homeboy Industries CEO Thomas Vozzo said the bakery would expand.",
        "Thomas Vozzo, Homeboy’s CEO, joined in 2011.",
      ],
    });
    assert.deepEqual(settled.officerConflicts, [{ org: "Homeboy Industries", ceo: "Thomas Vozzo" }]);
    assert.match(person.currentRole!, /Executive Director/);
    assert.doesNotMatch(person.currentRole!, /\bCEO\b|chief executive/i);
    assert.ok(settled.careerHistory.every((c) => !/\bCEO\b/.test(c.title)), JSON.stringify(settled.careerHistory));

    const bundle: PersonResearchBundle = {
      query: "x", generatedAt: "2026-10-29T00:00:00Z", person: { ...person, affiliation: "Homeboy Industries" }, careerHistory: settled.careerHistory,
      news: [], sources: [], officerConflicts: settled.officerConflicts,
      corporateAffiliations: [{ companyName: "HOMEBOY INDUSTRIES", position: "Founder and Chief Executive Officer" }],
    };
    applyPersonConsistency(bundle);
    assert.doesNotMatch(bundle.corporateAffiliations![0].position!, /chief executive|ceo/i);
  });
});
