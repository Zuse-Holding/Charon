import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchBundle } from "../../types/research.js";

// The failure watcher wraps globalThis.fetch when first used, so the stub
// goes in before anything runs.
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("down")) return new Response("unavailable", { status: 503 });
  if (url.includes("offline")) throw new TypeError("fetch failed");
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const { CoverageRecorder } = await import("./recorder.js");
const { COVERAGE_SECTION_TITLE, coverageSummary } = await import("./render.js");
const { sourcesFor, deepLink, sourceById } = await import("./registry.js");
const { ReportAgent } = await import("../../agents/report-agent/index.js");

// Must match COVERAGE_LINE in web/components/ReportViewer.tsx.
const COVERAGE_LINE = /^\[(results|no_results|not_searched|error)\] (.+?) \| (.+?) \| (.+?) \| (.+?) \| (?:\[(.+?)\]\((.+?)\)|-)$/;

const ENV = { SERPER_API_KEY: "test", TRADE_GOV_API_KEY: "test" };
const empty = { awards: [] as unknown[], sources: [] };
const never = () => new Promise<typeof empty>(() => {});

const company = (coverage: ResearchBundle["coverage"]): ResearchBundle => ({
  query: "Acme", generatedAt: "2026-10-05T12:00:00.000Z", company: { name: "Acme" },
  leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], coverage,
});

function coverageLines(md: string): string[] {
  const start = md.indexOf(`## ${COVERAGE_SECTION_TITLE}`);
  const end = md.indexOf("\n## ", start + 1);
  return md.slice(start, end).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
}

describe("coverage ledger (acceptance)", () => {
  it("a source that times out renders as Error, not no results", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV, 20);
    const value = await cov.run("usaspending", never, empty, (r) => r.awards.length);
    assert.deepEqual(value, empty);

    const md = new ReportAgent().generate(company(cov.result()));
    const line = coverageLines(md).find((l) => l.includes("USAspending"))!;
    assert.match(line, /^\[error\]/);
    assert.match(line, /Error: Timed out/);
    assert.doesNotMatch(line, /No matches/);
  });
});

describe("coverage recorder", () => {
  it("a failed request with nothing returned is an error", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV);
    await cov.run("usaspending", async () => { await fetch("https://api.usaspending.gov/down"); return empty; }, empty, (r) => r.awards.length);
    const e = cov.result()!.find((x) => x.id === "usaspending")!;
    assert.equal(e.status, "error");
    assert.match(e.reason!, /returned 503/);
  });

  it("a network error the agent swallowed is still an error", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV);
    await cov.run("usaspending", async () => {
      try { await fetch("https://api.usaspending.gov/offline"); } catch { /* agents return [] on failure */ }
      return empty;
    }, empty, (r) => r.awards.length);
    assert.equal(cov.result()!.find((x) => x.id === "usaspending")!.status, "error");
  });

  it("a throw becomes an error and the empty value is used", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV);
    const v = await cov.run("usaspending", async () => { throw new Error("boom"); }, empty, (r) => r.awards.length);
    assert.deepEqual(v, empty);
    assert.match(cov.result()!.find((x) => x.id === "usaspending")!.reason!, /boom/);
  });

  it("a clean empty answer is no results, with the query used", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV);
    await cov.run("usaspending", async () => { await fetch("https://api.usaspending.gov/ok"); return empty; }, empty, (r) => r.awards.length);
    const e = cov.result()!.find((x) => x.id === "usaspending")!;
    assert.equal(e.status, "no_results");
    assert.equal(e.query, "Acme");
  });

  it("results win over a failed retry, and report their count and section", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV);
    await cov.run("usaspending", async () => { await fetch("https://api.usaspending.gov/down"); return { awards: [1, 2], sources: [] }; },
      empty, (r) => r.awards.length);
    const e = cov.result()!.find((x) => x.id === "usaspending")!;
    assert.equal(e.status, "results");
    assert.equal(e.count, 2);
    assert.equal(e.section, "Federal Spending");
  });

  it("a failure at another source's host doesn't count against this one", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV);
    await cov.run("usaspending", async () => { await fetch("https://example.com/down"); return empty; }, empty, (r) => r.awards.length);
    assert.equal(cov.result()!.find((x) => x.id === "usaspending")!.status, "no_results");
  });

  it("a source missing its API key is an error and never runs", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", {});
    let ran = false;
    await cov.run("news", async () => { ran = true; return { news: [] }; }, { news: [] }, (r) => r.news.length);
    assert.equal(ran, false);
    assert.equal(cov.result()!.find((x) => x.id === "news")!.status, "error");
  });

  it("lists every source for the report type, skipped ones with a pre-filled link", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme & Sons", ENV);
    cov.skip("sanctions", "Included with Pro.");
    const all = cov.result()!;
    assert.deepEqual(all.map((e) => e.id), sourcesFor("company").map((s) => s.id));
    const sanctions = all.find((e) => e.id === "sanctions")!;
    assert.equal(sanctions.status, "not_searched");
    assert.equal(sanctions.reason, "Included with Pro.");
    const courts = all.find((e) => e.id === "courtlistener")!;
    assert.equal(courts.status, "not_searched");
    assert.equal(courts.url, "https://www.courtlistener.com/?q=%22Acme%20%26%20Sons%22");
    for (const s of sourcesFor("company").filter((x) => x.access === "deep_link")) {
      assert.ok(all.find((e) => e.id === s.id)!.url?.startsWith("https://"), s.id);
    }
  });

  it("does nothing when the flag is off", async () => {
    const cov = new CoverageRecorder(false, "company", "Acme", ENV, 20);
    const v = await cov.run("usaspending", async () => ({ awards: [1], sources: [] }), empty, (r) => r.awards.length);
    assert.deepEqual(v.awards, [1]);
    assert.equal(cov.result(), undefined);
    assert.ok(!new ReportAgent().generate(company(undefined)).includes(COVERAGE_SECTION_TITLE));
  });
});

describe("coverage report section", () => {
  it("states coverage in one line and renders every row in the viewer's format", async () => {
    const cov = new CoverageRecorder(true, "company", "Acme", ENV, 20);
    await cov.run("usaspending", never, empty, (r) => r.awards.length);
    await cov.run("news", async () => ({ news: [1] }), { news: [] }, (r) => r.news.length);
    await cov.run("competitors", async () => ({ c: [] }), { c: [] }, (r) => r.c.length);
    const entries = cov.result()!;
    const total = sourcesFor("company").length;
    assert.equal(coverageSummary(entries), `2 of ${total} sources searched; 1 failed; ${total - 3} require manual check.`);

    const md = new ReportAgent().generate(company(entries));
    assert.ok(md.includes(`_${coverageSummary(entries)}_`));
    const lines = coverageLines(md);
    assert.equal(lines.length, total);
    for (const l of lines) assert.match(l, COVERAGE_LINE, l);
    // near the top: straight after the executive summary
    assert.ok(md.indexOf(`## ${COVERAGE_SECTION_TITLE}`) < md.indexOf("## Company Overview"));
  });

  it("deep links encode the query", () => {
    assert.equal(deepLink(sourceById("nonprofits"), "A|B (C)"), "https://projects.propublica.org/nonprofits/search?q=A%7CB%20(C)");
  });
});
