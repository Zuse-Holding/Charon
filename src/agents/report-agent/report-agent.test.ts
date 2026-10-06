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
