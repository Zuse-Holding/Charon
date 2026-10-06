import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportAgent } from "../../agents/report-agent/index.js";
import type { PersonResearchBundle, ResearchBundle } from "../../types/research.js";
import { buildCompanyProvenance, buildPersonProvenance } from "./build.js";
import { FindingSchema } from "./findings.js";
import { PROVENANCE_SECTION_TITLE } from "./render.js";
import { sha256, type Snapshot } from "./snapshots.js";

// Must match FINDING_LINE in web/components/ReportViewer.tsx.
const FINDING_LINE = /^\[(confirmed|single_source|unverified)\] (.+?) \| (.+?) \| \[(.+?)\]\((.+?)\) \| (\d{4}-\d{2}-\d{2}) \| (\w+)$/;

const T = "2026-10-05T12:00:00.000Z";
const snap = (url: string, body: string): Snapshot =>
  ({ sha256: sha256(body), url, host: new URL(url).hostname, retrievedAt: T, status: 200, contentType: "text/html", body });

const snapshots = [
  snap("https://acme.com/about", "Acme was founded in 2012 and is based in Austin. Jane Doe is CEO."),
  snap("https://news.example.com/acme", "Jane Doe, CEO of Acme, announced Widget Pro. Rival Globex responded."),
  snap("https://google.serper.dev/news", JSON.stringify({ news: [{ title: "Acme | raises $40 million", link: "https://news.example.com/acme" }] })),
  snap("https://projects.propublica.org/nonprofits/api/v2/search.json?q=Acme", JSON.stringify({ organizations: [{ ein: 123456789, name: "ACME FOUNDATION" }] })),
];

const company: ResearchBundle = {
  query: "Acme", generatedAt: T,
  company: { name: "Acme", founded: "2012", headquarters: "Austin", industry: "Industrial widgets" },
  leadership: [{ name: "Jane Doe", title: "CEO" }],
  products: [{ name: "Widget Pro" }],
  news: [{ headline: "Acme | raises $40 million", url: "https://news.example.com/acme" }],
  funding: [{ round: "Series B", amount: "$40 million" }],
  competitors: [{ name: "Globex", url: "#" }],
  risks: ["Customer concentration could hurt margins"],
  opportunities: [],
  nonprofitFilings: [{ ein: "12-3456789", name: "ACME FOUNDATION", url: "https://projects.propublica.org/nonprofits/organizations/123456789" }],
  sources: [{ url: "https://acme.com/about", title: "About Acme", retrievedAt: T, usedFor: ["overview"] }],
};

describe("company provenance", () => {
  const built = buildCompanyProvenance(company, snapshots);
  const f = built.record.findings;
  const by = (section: string, claim: string) => f.find((x) => x.section === section && x.claim.includes(claim));

  it("every finding passes the schema", () => {
    for (const x of f) assert.doesNotThrow(() => FindingSchema.parse(x));
  });

  it("covers each section with the right method and verification", () => {
    assert.equal(by("Leadership", "Jane Doe")?.verification, "confirmed");   // acme.com + example.com
    assert.equal(by("Leadership", "Jane Doe")?.retrieval_method, "ai_extracted");
    assert.equal(by("Company Overview", "Founded")?.verification, "single_source");
    assert.equal(by("Company Overview", "Industry")?.verification, "unverified"); // a label, not stated text
    assert.equal(by("Competitors", "Globex")?.source_url, "https://news.example.com/acme"); // "#" ignored
    assert.equal(by("Recent News", "raises")?.retrieval_method, "api");
    assert.equal(by("Public Records", "ACME FOUNDATION")?.source_name, "ProPublica Nonprofit Explorer");
    assert.equal(by("Risks", "Customer concentration")?.verification, "unverified");
  });

  it("stores a stand-in record for every claim no response contained", () => {
    const stored = new Set(built.snapshots.map((s) => s.sha256));
    for (const x of f) assert.ok(stored.has(x.snapshot_hash), `${x.claim} has no stored snapshot`);
    assert.equal(built.record.snapshotCount, snapshots.length);
  });

  it("renders a Findings and Sources section the web viewer can parse", () => {
    const md = new ReportAgent().generate({ ...company, provenance: built.record });
    const section = md.slice(md.indexOf(`## ${PROVENANCE_SECTION_TITLE}`), md.indexOf("## Disclaimer"));
    const lines = section.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(lines.length, f.length);
    for (const l of lines) assert.match(l.slice(2), FINDING_LINE, l);
    // the pipe inside a headline must not break the row
    assert.ok(lines.some((l) => l.includes("Acme / raises $40 million")));
    assert.ok(md.indexOf(`## ${PROVENANCE_SECTION_TITLE}`) < md.indexOf("## Disclaimer"));
  });

  it("leaves reports unchanged when provenance is off", () => {
    const md = new ReportAgent().generate(company);
    assert.ok(!md.includes(PROVENANCE_SECTION_TITLE));
  });
});

describe("person provenance", () => {
  it("traces career entries and public records", () => {
    const person = {
      query: "Jane Doe", generatedAt: T, person: { name: "Jane Doe", currentRole: "CEO", currentCompany: "Acme" },
      careerHistory: [{ title: "CEO", company: "Acme" }], news: [], sources: [],
      corporateAffiliations: [{ companyName: "Globex", position: "Director", companyUrl: "https://opencorporates.com/companies/us_de/1" }],
    } as PersonResearchBundle;
    const { record } = buildPersonProvenance(person, snapshots);
    const role = record.findings.find((x) => x.section === "Current Role");
    assert.equal(role?.verification, "confirmed");
    const aff = record.findings.find((x) => x.section === "Corporate Affiliations");
    assert.equal(aff?.source_url, "https://opencorporates.com/companies/us_de/1");
    assert.equal(aff?.retrieval_method, "api");
  });
});
