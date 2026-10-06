import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchBundle } from "../../types/research.js";
import { ReportAgent } from "../report-agent/index.js";
import { buildCompanyProvenance } from "../../lib/provenance/build.js";
import { sha256, type Snapshot } from "../../lib/provenance/snapshots.js";
import { dohUrl, evaluatePosture, parseRdap, type DomainFacts } from "./index.js";
import { POSTURE_SECTION_TITLE } from "./render.js";

// Must match POSTURE_LINE in web/components/ReportViewer.tsx.
const POSTURE_LINE = /^\[(ok|info|unknown|flag:(?:high|medium|low))\] (.+?) \| (.+?) \| (.+?) \| \[(.+?)\]\((.+?)\)$/;

const NOW = new Date("2026-10-06T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const healthy: DomainFacts = {
  domain: "acme.com",
  rdap: {
    url: "https://rdap.org/domain/acme.com", expiresAt: inDays(400), registeredAt: "2001-01-01T00:00:00Z",
    status: ["client transfer prohibited"], registrar: "Example Registrar", registrant: { hidden: false, org: "Acme LLC", name: "Domain Admin" },
  },
  ns: ["ns1.example.net"], mx: ["10 mx.example.net"],
  txt: ["v=spf1 include:_spf.example.net -all"], dmarc: ["v=DMARC1; p=reject"], caa: ['0 issue "letsencrypt.org"'],
  tls: { validTo: inDays(80), issuer: "Let's Encrypt" },
};
const check = (f: DomainFacts, id: string) => evaluatePosture(f, NOW).checks.find((c) => c.id === id)!;

function postureLines(md: string): string[] {
  const start = md.indexOf(`## ${POSTURE_SECTION_TITLE}`);
  return md.slice(start, md.indexOf("\n## ", start + 1)).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
}

const bundle = (domainPosture: ResearchBundle["domainPosture"]): ResearchBundle => ({
  query: "Acme", generatedAt: NOW.toISOString(), company: { name: "Acme" },
  leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], domainPosture,
});

describe("domain posture (acceptance)", () => {
  it("no DMARC and expiry in 30 days show both flags with their buyer-impact lines", () => {
    const facts: DomainFacts = { ...healthy, dmarc: [], rdap: { ...healthy.rdap!, expiresAt: inDays(30) } };
    const md = new ReportAgent().generate(bundle(evaluatePosture(facts, NOW)));
    const lines = postureLines(md);
    const expiry = lines.find((l) => l.includes("Registration and expiry"))!;
    const dmarc = lines.find((l) => l.includes("DMARC"))!;
    assert.match(expiry, /^\[flag:high\]/);
    assert.match(expiry, /in 30 days/);
    assert.match(expiry, /closing condition/);
    assert.match(dmarc, /^\[flag:medium\] DMARC \| No DMARC record\./);
    assert.match(dmarc, /fake invoices or payment-change requests/);
    for (const l of lines) assert.match(l, POSTURE_LINE, l);
    assert.ok(md.includes("_acme.com: 2 flags (1 high, 1 medium)."));
  });
});

describe("posture checks", () => {
  it("a healthy domain has no flags; DNS is informational", () => {
    const p = evaluatePosture(healthy, NOW);
    assert.deepEqual(p.checks.filter((c) => c.status === "flag"), []);
    assert.equal(check(healthy, "dns").status, "info");
  });

  it("a privacy-protected registrant is reported as hidden, not flagged", () => {
    const c = check({ ...healthy, rdap: { ...healthy.rdap!, registrant: { hidden: true } } }, "registrant");
    assert.equal(c.status, "info");
    assert.equal(c.detail, "Registrant hidden (privacy-protected record).");
  });

  it("flags a domain registered to an individual", () => {
    const c = check({ ...healthy, rdap: { ...healthy.rdap!, registrant: { hidden: false, name: "Jane Founder" } } }, "registrant");
    assert.equal(c.status, "flag");
    assert.match(c.impact!, /transfer to the business a closing condition/);
    assert.equal(check({ ...healthy, rdap: { ...healthy.rdap!, registrant: { hidden: false, name: "Acme Holdings LLC" } } }, "registrant").status, "ok");
  });

  it("flags a missing transfer lock", () => {
    assert.equal(check({ ...healthy, rdap: { ...healthy.rdap!, status: ["active"] } }, "transfer_lock").status, "flag");
    assert.equal(check({ ...healthy, rdap: { ...healthy.rdap!, status: ["clientTransferProhibited"] } }, "transfer_lock").status, "ok");
  });

  it("flags SPF that's missing or ends in +all (or a bare all)", () => {
    assert.equal(check({ ...healthy, txt: ["google-site-verification=x"] }, "spf").severity, "medium");
    assert.equal(check({ ...healthy, txt: ["v=spf1 include:x +all"] }, "spf").severity, "high");
    assert.equal(check({ ...healthy, txt: ["v=spf1 a mx all"] }, "spf").severity, "high");
    assert.equal(check({ ...healthy, txt: ["v=spf1 a ~all"] }, "spf").status, "ok");
  });

  it("flags DMARC p=none, CAA missing (low) and a certificate expiring within 30 days", () => {
    assert.equal(check({ ...healthy, dmarc: ["v=DMARC1; p=none; rua=mailto:x@acme.com"] }, "dmarc").severity, "low");
    assert.equal(check({ ...healthy, caa: [] }, "caa").severity, "low");
    assert.equal(check({ ...healthy, tls: { validTo: inDays(12) } }, "tls").status, "flag");
    assert.equal(check({ ...healthy, tls: { validTo: inDays(31) } }, "tls").status, "ok");
  });

  it("a failed lookup is unknown, never a flag", () => {
    const p = evaluatePosture({ domain: "acme.com" }, NOW);
    assert.ok(p.checks.every((c) => c.status === "unknown"));
  });
});

describe("RDAP parsing", () => {
  it("reads expiry and lock from the registry, registrant from the registrar, and spots redaction", () => {
    const registry = {
      status: ["client transfer prohibited"],
      events: [{ eventAction: "expiration", eventDate: "2027-09-11T04:00:00Z" }, { eventAction: "registration", eventDate: "1995-09-12T04:00:00Z" }],
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "SafeNames Ltd."]]] as [string, [string, Record<string, unknown>, string, unknown][]] }],
    };
    const registrar = { entities: [{ roles: ["registrant"], remarks: [{ title: "REDACTED FOR PRIVACY" }] }] };
    const r = parseRdap("https://rdap.org/domain/stripe.com", registry, registrar);
    assert.equal(r.expiresAt, "2027-09-11T04:00:00Z");
    assert.equal(r.registrar, "SafeNames Ltd.");
    assert.deepEqual(r.registrant, { hidden: true, kind: undefined, name: undefined, org: undefined });
  });
});

describe("provenance for domain checks", () => {
  it("a check read straight from a stored DNS answer is single source, linked to that answer", () => {
    const posture = evaluatePosture({ ...healthy, dmarc: [] }, NOW);
    const body = JSON.stringify({ Status: 3, Question: [{ name: "_dmarc.acme.com", type: 16 }] });
    const url = dohUrl("_dmarc.acme.com", "TXT");
    const snap: Snapshot = { sha256: sha256(body), url, host: "cloudflare-dns.com", retrievedAt: NOW.toISOString(), status: 200, contentType: "application/dns-json", body };
    const { record } = buildCompanyProvenance(bundle(posture), [snap]);
    const f = record.findings.find((x) => x.section === "Domain Posture" && x.claim.startsWith("DMARC"))!;
    assert.equal(f.verification, "single_source");
    assert.equal(f.source_url, url);
    assert.equal(f.snapshot_hash, snap.sha256);
    assert.equal(f.retrieval_method, "api");
  });
});
