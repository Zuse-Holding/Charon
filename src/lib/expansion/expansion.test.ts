import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportAgent } from "../../agents/report-agent/index.js";
import { RELATED_SECTION_TITLE } from "../../agents/related-entities-agent/render.js";
import type { ResearchBundle } from "../../types/research.js";
import { buildCompanyProvenance } from "../provenance/build.js";
import { sha256, type Snapshot } from "../provenance/snapshots.js";
import { MAX_HOPS, clampHops, expandRelated, type LinkKind, type RegistryProvider, type RegistryRecord } from "./engine.js";
import { MASS_THRESHOLD, isMassAgentAddress, isMassAgentName, normalizeAddress } from "./mass-agents.js";

// Must match NODE_LINE / EDGE_LINE in web/components/ReportViewer.tsx.
const NODE_LINE = /^node (n\d+) \| (company|person|agent|address) \| (.+?) \| (.+?) \| (\d) \| (.+)$/;
const EDGE_LINE = /^edge (n\d+) > (n\d+) \| (.+?) \| (hard|weak) \| (confirmed|single_source|unverified) \| \[(.+?)\]\((.+?)\) \| (\d{4}-\d{2}-\d{2})$/;

const T = "2026-10-07T12:00:00.000Z";
let n = 0;
function filing(name: string, extra: Partial<RegistryRecord> = {}): RegistryRecord {
  const number = String(++n);
  return { issuer: "us_ny", number, name, url: `https://data.ny.gov/resource/n9v6-gdp6.json?dos_id=${number}`,
    sourceName: "New York Department of State filing", retrievedAt: T, officers: [], addresses: [], ...extra };
}
const addr = (s: string) => normalizeAddress([s])!;

/** A registry held in memory. sharing() searches every filing, like the real one. */
class FakeRegistry implements RegistryProvider {
  calls: string[] = [];
  constructor(public filings: RegistryRecord[]) {}
  async findCompanies(name: string) { return this.filings.filter((f) => f.name.toLowerCase().startsWith(name.toLowerCase().slice(0, 4))); }
  async sharing(kind: LinkKind, value: string, limit: number) {
    this.calls.push(`${kind}:${value}`);
    const hits = this.filings.filter((f) =>
      kind === "officer" ? f.officers.some((o) => o.name === value)
        : kind === "agent" ? f.agent?.name === value
          : f.addresses.some((a) => a.address === value));
    return { records: hits.slice(0, limit), total: hits.length };
  }
}

describe("related entities (acceptance)", () => {
  it("a target registered through a commercial registered agent doesn't pull in the agent's other clients", async () => {
    const agentAddress = addr("1209 Orange St, Wilmington DE 19801");
    const ct = { name: "C T Corporation System", address: agentAddress };
    const clients = Array.from({ length: 40 }, (_, i) => filing(`Unrelated Client ${i} LLC`, { agent: ct, addresses: [{ role: "service of process", address: agentAddress }] }));
    const target = filing("Acme Widgets LLC", { agent: ct, addresses: [{ role: "service of process", address: agentAddress }] });
    // an agent missing from the maintained list is still caught by size
    const bigAgent = { name: "Smallville Filing Helpers Inc", address: addr("12 Main St, Hudson NY 12534") };
    const bigClients = Array.from({ length: MASS_THRESHOLD + 5 }, (_, i) => filing(`Other Co ${i} Inc`, { agent: bigAgent }));
    const target2 = filing("Beta Bolts Inc", { agent: bigAgent });
    const reg = new FakeRegistry([target, target2, ...clients, ...bigClients]);

    for (const [name, agent] of [["Acme Widgets LLC", ct.name], ["Beta Bolts Inc", bigAgent.name]] as const) {
      const g = await expandRelated(name, reg);
      const companies = g.nodes.filter((x) => x.kind === "company");
      assert.deepEqual(companies.map((c) => c.label), [name], `${name}: only the target, none of the agent's clients`);
      assert.ok(g.excluded.includes(agent));
      assert.ok(!g.nodes.some((x) => x.kind === "agent"));
    }
    assert.ok(!reg.calls.includes(`agent:${ct.name}`), "a listed mass agent is never even searched");
  });
});

describe("related entities", () => {
  const sharedAddress = addr("88 Pine Rd, Latham NY 12110");
  const target = filing("Coyne Holdings Inc", { officers: [{ name: "EDWARD J COYNE", role: "chairman or CEO" }],
    agent: { name: "Jane Lawyer Esq" }, addresses: [{ role: "principal office", address: sharedAddress }] });
  const sameOfficer = filing("Coyne Lawn Care Inc", { officers: [{ name: "EDWARD J COYNE", role: "chairman or CEO" }] });
  const sameAddress = filing("Pine Rd Storage Corp", { addresses: [{ role: "principal office", address: sharedAddress }],
    officers: [{ name: "SOMEONE ELSE", role: "chairman or CEO" }] });
  const twoHopsAway = filing("Someone Else Ventures Inc", { officers: [{ name: "SOMEONE ELSE", role: "chairman or CEO" }] });
  const sameAgent = filing("Lawyer Client Corp", { agent: { name: "Jane Lawyer Esq" } });
  const reg = () => new FakeRegistry([target, sameOfficer, sameAddress, twoHopsAway, sameAgent]);

  it("draws the filing's own links as hard and name/address matches as weak", async () => {
    const g = await expandRelated("Coyne Holdings Inc", reg());
    const label = (id: string) => g.nodes.find((x) => x.id === id)!.label;
    const rel = g.edges.map((e) => `${e.strength}: ${label(e.from)} -> ${label(e.to)}`).sort();
    assert.deepEqual(rel, [
      "hard: Coyne Holdings Inc -> 88 pine rd latham ny 12110",
      "hard: Coyne Holdings Inc -> EDWARD J COYNE",
      "hard: Coyne Holdings Inc -> Jane Lawyer Esq",
      "weak: 88 pine rd latham ny 12110 -> Pine Rd Storage Corp",
      "weak: EDWARD J COYNE -> Coyne Lawn Care Inc",
      "weak: Jane Lawyer Esq -> Lawyer Client Corp",
    ].sort());
    for (const e of g.edges) assert.equal(e.verification, e.strength === "hard" ? "single_source" : "unverified");
  });

  it("never follows a weak link, whatever the hop limit", async () => {
    const g = await expandRelated("Coyne Holdings Inc", reg(), { hops: 3 });
    assert.ok(!g.nodes.some((x) => x.label === "Someone Else Ventures Inc"), "reached only through a weak link's officer");
    assert.ok(!g.nodes.some((x) => x.label === "SOMEONE ELSE"));
  });

  it("hop limit: 1 shows only the filing itself; hard cap is 3", async () => {
    const g = await expandRelated("Coyne Holdings Inc", reg(), { hops: 1 });
    assert.ok(g.nodes.every((x) => x.hop <= 1));
    assert.equal(g.nodes.filter((x) => x.kind === "company").length, 1);
    assert.equal(clampHops(9), MAX_HOPS);
    assert.equal(clampHops(undefined), 2);
    assert.equal((await expandRelated("Coyne Holdings Inc", reg(), { hops: 9 })).hops, 3);
  });

  it("an officer on the self-exclusion list is never followed", async () => {
    const g = await expandRelated("Coyne Holdings Inc", reg(), { mayFollow: async (kind, v) => !(kind === "officer" && v === "EDWARD J COYNE") });
    assert.ok(!g.nodes.some((x) => x.label === "Coyne Lawn Care Inc"));
    assert.equal(g.withheld, 1);
  });

  it("people are never merged by name: same name on two filings is two nodes", async () => {
    const a = filing("Delta One LLC", { officers: [{ name: "PAT LEE", role: "chairman or CEO" }] });
    const b = filing("Delta One Inc", { officers: [{ name: "PAT LEE", role: "chairman or CEO" }] });
    const g = await expandRelated("Delta One", new FakeRegistry([a, b]));
    assert.equal(g.nodes.filter((x) => x.kind === "person").length, 2);
  });

  it("an officer name on too many filings isn't linked at all", async () => {
    const common = Array.from({ length: MASS_THRESHOLD + 1 }, (_, i) => filing(`Smith Co ${i}`, { officers: [{ name: "JOHN SMITH", role: "chairman or CEO" }] }));
    const t = filing("Echo Labs Inc", { officers: [{ name: "JOHN SMITH", role: "chairman or CEO" }] });
    const g = await expandRelated("Echo Labs Inc", new FakeRegistry([t, ...common]));
    assert.deepEqual(g.common, ["JOHN SMITH"]);
    assert.equal(g.nodes.filter((x) => x.kind === "company").length, 1);
  });

  it("renders a section the viewer can parse, and each filing link is a traceable finding", async () => {
    const g = await expandRelated("Coyne Holdings Inc", reg());
    const bundle: ResearchBundle = { query: "Coyne Holdings Inc", generatedAt: T, company: { name: "Coyne Holdings Inc" },
      leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], relatedEntities: g };
    const md = new ReportAgent().generate(bundle);
    const start = md.indexOf(`## ${RELATED_SECTION_TITLE}`);
    const lines = md.slice(start, md.indexOf("\n## ", start + 1)).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
    assert.equal(lines.filter((l) => NODE_LINE.test(l)).length, g.nodes.length);
    assert.equal(lines.filter((l) => EDGE_LINE.test(l)).length, g.edges.length);
    assert.match(md, /3 related companies within 2 hops; 3 links found by name or address only \(shown, not followed\)/);

    const body = JSON.stringify([{ dos_id: target.number }]);
    const snap: Snapshot = { sha256: sha256(body), url: target.url, host: "data.ny.gov", retrievedAt: T, status: 200, contentType: "application/json", body };
    const f = buildCompanyProvenance(bundle, [snap]).record.findings.filter((x) => x.section === "Related Entities");
    assert.equal(f.length, g.edges.length);
    assert.ok(f.filter((x) => x.source_url === target.url).every((x) => x.verification === "single_source"));
    assert.ok(f.filter((x) => x.source_url !== target.url).every((x) => x.verification === "unverified"));
  });
});

describe("mass agent detection", () => {
  it("knows the big agents by name and office address", () => {
    assert.ok(isMassAgentName("UNITED STATES CORPORATION AGENTS, INC."));
    assert.ok(isMassAgentName("Corporation Service Company"));
    assert.ok(isMassAgentName("Northwest Registered Agent LLC"));
    assert.ok(!isMassAgentName("Jane Lawyer Esq"));
    assert.ok(isMassAgentAddress(addr("251 Little Falls Drive, Wilmington DE 19808")));
    assert.ok(!isMassAgentAddress(addr("88 Pine Rd, Latham NY 12110")));
  });
});
