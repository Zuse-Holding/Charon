import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPORT_DISCLAIMER } from "../../lib/disclaimer.js";
import type {
  CreatorResearchBundle, PersonResearchBundle, PoliticalResearchBundle, ProductResearchBundle, ResearchBundle,
} from "../../types/research.js";
import { ReportAgent } from "./index.js";

const at = "2026-10-05T12:00:00.000Z";

const company = {
  query: "Acme", generatedAt: at, company: { name: "Acme" }, leadership: [], products: [], news: [],
  funding: [], competitors: [], sources: [],
} as ResearchBundle;
const person = {
  query: "Jane Doe", generatedAt: at, person: { name: "Jane Doe" }, careerHistory: [], news: [], sources: [],
} as unknown as PersonResearchBundle;
const product = {
  query: "Widget", generatedAt: at, product: { name: "Widget" }, specs: [], competitors: [], news: [], sources: [],
} as unknown as ProductResearchBundle;
const political = {
  query: "Sen. Smith", generatedAt: at, profile: { name: "Sen. Smith" }, votingRecord: [], campaignFinance: [],
  oppositionResearch: [], news: [], sources: [],
} as unknown as PoliticalResearchBundle;
const creator = {
  query: "@maker", generatedAt: at, profile: { name: "@maker" }, signals: [], shortFormMentions: [], news: [], sources: [],
} as unknown as CreatorResearchBundle;

describe("report footer", () => {
  const agent = new ReportAgent();
  const reports: [string, () => string][] = [
    ["company", () => agent.generate(company)],
    ["person", () => agent.generatePerson(person)],
    ["product", () => agent.generateProduct(product)],
    ["political", () => agent.generatePolitical(political)],
    ["creator", () => agent.generateCreator(creator)],
  ];

  for (const [kind, render] of reports) {
    it(`${kind} reports end with the consumer-report disclaimer`, () => {
      const md = render();
      const lastSection = md.slice(md.lastIndexOf("\n## "));
      assert.match(lastSection, /^\n## Disclaimer\n/);
      assert.ok(lastSection.includes(REPORT_DISCLAIMER));
    });
  }

  it("no report mentions the removed Offshore Leaks source", () => {
    for (const [, render] of reports) assert.doesNotMatch(render(), /offshore leaks|ICIJ/i);
  });
});

describe("person photo", () => {
  const agent = new ReportAgent();
  const photo = {
    imageUrl: "https://upload.wikimedia.org/thumb/x.jpg", filePageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    wikipediaUrl: "https://en.wikipedia.org/wiki/Jane_Doe", wikipediaTitle: "Jane Doe", wikidataId: "Q1",
    description: "American executive (born 1970)", artist: "A. Photographer", license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
  };

  it("shows the photo with its Wikipedia link and Commons credit, before About", () => {
    const md = agent.generatePerson({ ...person, photo });
    assert.ok(md.includes("## Photo\n![Jane Doe](https://upload.wikimedia.org/thumb/x.jpg)"));
    assert.ok(md.includes("- **Wikipedia:** [Jane Doe](https://en.wikipedia.org/wiki/Jane_Doe) — American executive (born 1970)"));
    assert.ok(md.includes("- **Photo:** A. Photographer, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:X.jpg)"));
    assert.ok(md.indexOf("## Photo") < md.indexOf("## About"));
  });

  it("parentheses in Commons URLs don't break the links", () => {
    const md = agent.generatePerson({ ...person, photo: { ...photo, filePageUrl: "https://commons.wikimedia.org/wiki/File:Jane_(cropped).jpg" } });
    assert.ok(md.includes("via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Jane_%28cropped%29.jpg)"));
  });

  it("no Photo section without a photo", () => {
    assert.ok(!agent.generatePerson(person).includes("## Photo"));
  });
});
