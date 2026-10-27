import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRoleChange, personNews, roleFromNews, summaryFromSnippet, tiedToPerson } from "./person-checks.js";
import { applyPersonConsistency } from "./consistency.js";
import type { NewsEntry, PersonResearchBundle } from "../types/research.js";

const now = new Date("2026-10-27T00:00:00Z");
const personOf = (over: Partial<PersonResearchBundle>): PersonResearchBundle => ({
  query: "Jane Doe", generatedAt: "2026-10-27T00:00:00Z", person: { name: "Jane Doe" }, careerHistory: [], news: [], sources: [], ...over,
});

describe("round twenty: company-search fixes in person search", () => {
  it("a name alone never confirms an officer record", () => {
    const bundle = personOf({
      person: { name: "Jane Doe", currentCompany: "Acme Robotics" },
      careerHistory: [{ title: "VP Sales", company: "Bank of America" }],
      corporateAffiliations: [
        { companyName: "ACME ROBOTICS, INC." },
        { companyName: "Bank of America Corporation" },
        { companyName: "First National Bank of Ohio" },
        { companyName: "Doe Family Holdings LLC" },
      ],
      powerMapConnections: [{ name: "Jane Doe", blurb: "CEO of Acme Robotics", url: "https://littlesis.org/a" }, { name: "Jane Doe", blurb: "Ohio state senator", url: "https://littlesis.org/b" }],
    });
    applyPersonConsistency(bundle);
    assert.deepEqual(bundle.corporateAffiliations?.map((a) => a.companyName), ["ACME ROBOTICS, INC.", "Bank of America Corporation"]);
    assert.deepEqual(bundle.powerMapConnections?.map((p) => p.url), ["https://littlesis.org/a"]);
  });

  it("with nothing to tie a record to, none is kept", () => {
    const bundle = personOf({ corporateAffiliations: [{ companyName: "Doe Family Holdings LLC" }] });
    applyPersonConsistency(bundle);
    assert.equal(bundle.corporateAffiliations, undefined);
  });

  it("the typed affiliation counts by acronym", () => {
    assert.equal(tiedToPerson("Regents of the University of California, Los Angeles", [], "UCLA"), true);
    assert.equal(tiedToPerson("Stanford Health Care", ["UCLA"], "UCLA"), false);
  });

  it("the fallback summary is one sentence naming the person, never a pasted snippet", () => {
    assert.equal(summaryFromSnippet("Jane Doe is the chief executive of Acme Robotics, a warehouse automation firm. She joined in 2021.", "Jane Doe"),
      "Jane Doe is the chief executive of Acme Robotics, a warehouse automation firm.");
    // Another person's filing text: no sentence names Jane Doe.
    assert.equal(summaryFromSnippet("GPS CA, a wholly owned subsidiary of Argan, disputes approximately $663,000 from ACCO Engineered Systems.", "Jane Doe"), undefined);
    assert.equal(summaryFromSnippet("Jane Doe, who has led Acme Robotics since 2021 and previously ran sales at ...", "Jane Doe"), undefined);
    assert.equal(summaryFromSnippet("Jane Smith leads the team that works with Acme Robotics customers.", "Jane Doe"), undefined);
  });

  it("person news is dated, newest first, without gossip or law-firm ads", () => {
    const news = personNews([
      { title: "Jane Doe speaks at RoboCon", url: "https://news.example/a", date: "Mar 3, 2026" },
      { title: "Jane Doe and husband celebrate wedding anniversary", url: "https://news.example/b", date: "Oct 1, 2026" },
      { title: "Acme Robotics investors: Rosen Law Firm investigation, Jane Doe", url: "https://news.example/c", date: "Oct 2, 2026" },
      { title: "Jane Doe on warehouse robots", url: "https://news.example/d" },
      { title: "Jane Doe named CEO of Acme Robotics", url: "https://www.businesswire.com/news/2026/09/15/x", date: "3 days ago" },
    ], "Jane Doe", now);
    assert.deepEqual(news.map((n) => n.url), ["https://www.businesswire.com/news/2026/09/15/x", "https://news.example/a", "https://news.example/d"]);
    assert.equal(news[0].date, "Sep 15, 2026");
    assert.equal(news[0].outlet, "businesswire.com");
    assert.equal(news[2].date, undefined);
  });

  it("the newest dated appointment sets the current role", () => {
    const news: NewsEntry[] = [
      { headline: "Jane Doe Named Chief Executive Officer of Acme Robotics", date: "Sep 15, 2026" },
      { headline: "Jane Doe Joins Globex as Chief Revenue Officer", date: "Jan 5, 2025" },
    ];
    const change = roleFromNews(news, "Jane Doe", now);
    assert.deepEqual(change && { kind: change.kind, role: change.role, company: change.company }, { kind: "joined", role: "Chief Executive Officer", company: "Acme Robotics" });
    const bundle = personOf({ person: { name: "Jane Doe", currentRole: "Chief Revenue Officer", currentCompany: "Globex" }, careerHistory: [{ title: "Chief Revenue Officer", company: "Globex" }] });
    assert.ok(applyRoleChange(bundle, change));
    assert.equal(bundle.person.currentRole, "Chief Executive Officer");
    assert.equal(bundle.person.currentCompany, "Acme Robotics");
    assert.deepEqual(bundle.careerHistory.map((c) => c.company), ["Acme Robotics", "Globex"]);
  });

  it("reads 'joins X as' and ignores undated and old stories", () => {
    const joins = roleFromNews([{ headline: "Jane Doe joins Globex as its new Chief Revenue Officer", date: "Jan 5, 2026" }], "Jane Doe", now);
    assert.equal(joins?.kind === "joined" && `${joins.role} @ ${joins.company}`, "Chief Revenue Officer @ Globex");
    assert.equal(roleFromNews([{ headline: "Jane Doe named CEO of Acme Robotics" }], "Jane Doe", now), undefined);
    assert.equal(roleFromNews([{ headline: "Jane Doe named CEO of Acme Robotics", date: "Jan 5, 2023" }], "Jane Doe", now), undefined);
    assert.equal(roleFromNews([{ headline: "John Roe named CEO of Acme Robotics", date: "Sep 15, 2026" }], "Jane Doe", now), undefined);
  });

  it("a departure clears the role only when it names the current employer", () => {
    const left = roleFromNews([{ headline: "Jane Doe steps down as CEO of Acme Robotics", date: "Oct 1, 2026" }], "Jane Doe", now);
    const bundle = personOf({ person: { name: "Jane Doe", currentRole: "CEO", currentCompany: "Acme Robotics" } });
    assert.ok(applyRoleChange(bundle, left));
    assert.equal(bundle.person.currentRole, undefined);
    const elsewhere = personOf({ person: { name: "Jane Doe", currentRole: "CEO", currentCompany: "Acme Robotics" } });
    assert.equal(applyRoleChange(elsewhere, roleFromNews([{ headline: "Jane Doe resigns from Globex board", date: "Oct 1, 2026" }], "Jane Doe", now)), undefined);
    assert.equal(elsewhere.person.currentRole, "CEO");
    // Announced, not yet happened.
    assert.equal(roleFromNews([{ headline: "Jane Doe to step down as CEO of Acme Robotics", date: "Oct 1, 2026" }], "Jane Doe", now), undefined);
  });
});
