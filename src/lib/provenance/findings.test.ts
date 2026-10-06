import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalize, numericTerms, siteOf, traceFindings, validateFinding, type Candidate } from "./findings.js";
import { sha256, type Snapshot } from "./snapshots.js";

const T = "2026-10-05T12:00:00.000Z";

function snap(url: string, body: string, extra: Partial<Snapshot> = {}): Snapshot {
  return { sha256: sha256(body), url, host: new URL(url).hostname, retrievedAt: T, status: 200, contentType: "text/html", body, ...extra };
}

const valid = {
  section: "Leadership",
  claim: "Jane Doe — CEO",
  source_name: "acme.com",
  source_url: "https://acme.com/team",
  retrieved_at: T,
  retrieval_method: "ai_extracted",
  snapshot_hash: "a".repeat(64),
  verification: "single_source",
  supporting_hashes: [],
};

describe("finding validation (acceptance)", () => {
  it("accepts a complete finding", () => {
    assert.equal(validateFinding(valid).claim, "Jane Doe — CEO");
  });

  it("rejects a finding without source_url", () => {
    const { source_url: _, ...rest } = valid;
    assert.throws(() => validateFinding(rest), /source_url/);
  });

  it("rejects a finding without retrieved_at", () => {
    const { retrieved_at: _, ...rest } = valid;
    assert.throws(() => validateFinding(rest), /retrieved_at/);
  });

  it("rejects a search page that isn't a web address, a bad hash and unknown states", () => {
    assert.throws(() => validateFinding({ ...valid, source_url: "#" }));
    assert.throws(() => validateFinding({ ...valid, source_url: "javascript:alert(1)" }));
    assert.throws(() => validateFinding({ ...valid, snapshot_hash: "abc" }));
    assert.throws(() => validateFinding({ ...valid, verification: "probably" }));
    assert.throws(() => validateFinding({ ...valid, retrieval_method: "guessed" }));
  });
});

describe("tracing claims to stored responses", () => {
  const team = snap("https://acme.com/team", "<h2>Jane Doe</h2><p>Chief Executive</p>");
  const press = snap("https://news.example.com/acme", "Acme CEO Jane Doe said on Monday");
  const search = snap("https://google.serper.dev/search", JSON.stringify({ organic: [{ title: "Jane Doe — Acme" }] }));
  const lead: Candidate = { section: "Leadership", claim: "Jane Doe — CEO", terms: ["Jane Doe"], method: "ai_extracted" };
  const fallback = () => ({ url: "https://acme.com/", name: "Acme" });

  it("is confirmed when two independent sites contain the claim", () => {
    const { findings } = traceFindings([lead], [team, press, search], fallback);
    assert.equal(findings[0].verification, "confirmed");
    assert.equal(findings[0].supporting_hashes.length, 2);
  });

  it("is single source when one site does (a search engine is not a second source)", () => {
    const { findings } = traceFindings([lead], [team, search], fallback);
    assert.equal(findings[0].verification, "single_source");
    // links the page itself, not the search result
    assert.equal(findings[0].source_url, "https://acme.com/team");
    assert.equal(findings[0].snapshot_hash, team.sha256);
  });

  it("links a search-only claim to the result's page, not the search API", () => {
    const results = snap("https://google.serper.dev/search", JSON.stringify({ organic: [
      { title: "Other", link: "https://other.com/x" },
      { title: "Jane Doe named CEO", link: "https://press.example.com/jane" },
    ] }));
    const { findings } = traceFindings([lead], [results], fallback);
    assert.equal(findings[0].verification, "single_source");
    assert.equal(findings[0].source_url, "https://press.example.com/jane");
    assert.equal(findings[0].snapshot_hash, results.sha256);
  });

  it("keeps an AI claim no response contains: unverified, linked to the nearest source, never dropped", () => {
    const risk: Candidate = { section: "Risks", claim: "Margins may shrink as rivals cut prices", terms: [], method: "ai_extracted" };
    const { findings, generated } = traceFindings([risk], [team], fallback);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].verification, "unverified");
    assert.equal(findings[0].source_url, "https://acme.com/");
    assert.equal(findings[0].source_name, "Acme");
    // nothing fetched from that URL, so a stand-in record holds what the AI produced
    assert.equal(generated.length, 1);
    assert.equal(findings[0].snapshot_hash, generated[0].sha256);
    assert.ok(generated[0].generated);
  });

  it("traces an AI summary's numbers to the page that states them", () => {
    const page = snap("https://finance.example.com/acme", "Acme revenue reached $19.4 billion in 2025");
    const claim = "Revenue of $19.4 billion in 2025 suggests room to grow";
    const c: Candidate = { section: "Opportunities", claim, terms: numericTerms(claim), method: "ai_extracted" };
    const { findings } = traceFindings([c], [page], fallback);
    assert.equal(findings[0].verification, "single_source");
    assert.equal(findings[0].source_url, page.url);
  });

  it("keeps a public record's own link and attributes it to the API response that contained it", () => {
    const api = snap("https://data.trade.gov/consolidated_screening_list/v1/search?name=ACME&subscription-key=REDACTED",
      JSON.stringify({ results: [{ name: "ACME TRADING LLC", source: "SDN" }] }));
    const c: Candidate = { section: "Public Records", claim: "Possible sanctions match: ACME TRADING LLC (SDN)",
      terms: ["ACME TRADING LLC"], method: "api", recordUrl: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=1", sourceName: "SDN sanctions list" };
    const { findings } = traceFindings([c], [api], fallback);
    assert.equal(findings[0].source_url, "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=1");
    assert.equal(findings[0].snapshot_hash, api.sha256);
    assert.equal(findings[0].retrieval_method, "api");
  });

  it("ignores error responses and links that aren't web addresses", () => {
    const failed = snap("https://acme.com/team", "<h2>Jane Doe</h2>", { status: 500 });
    const c: Candidate = { ...lead, recordUrl: "#" };
    const { findings } = traceFindings([c], [failed], fallback);
    assert.equal(findings[0].verification, "unverified");
    assert.equal(findings[0].source_url, "https://acme.com/");
  });

  it("counts a claim with no link anywhere instead of throwing", () => {
    const { findings, untraceable } = traceFindings([{ ...lead, terms: [] }], [], () => undefined);
    assert.equal(findings.length, 0);
    assert.equal(untraceable, 1);
  });
});

describe("text helpers", () => {
  it("normalize decodes JSON escapes and entities and ignores punctuation", () => {
    assert.equal(normalize("O\\u2019Brien &amp; Co."), normalize("O’Brien & Co"));
    assert.ok(normalize("<b>Jane&nbsp;Doe</b>").includes(" jane doe "));
  });

  it("siteOf groups subdomains and handles two-level country domains", () => {
    assert.equal(siteOf("news.example.com"), "example.com");
    assert.equal(siteOf("www.bbc.co.uk"), "bbc.co.uk");
  });

  it("numericTerms keeps checkable numbers only", () => {
    assert.deepEqual(numericTerms("Valued at $159 billion in 2026, up 61.67% (Q3)"), ["$159", "2026", "61.67%"]);
  });
});
