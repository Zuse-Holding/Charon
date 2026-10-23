import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEnforcementAction, mentionsCompany } from "./news-noise.js";
import { isPersonName, rankLeadership } from "./leadership.js";
import { corporateActions } from "./corporate-actions.js";
import { caseContext, namedParty, rankCases, type CaseRecord } from "../agents/public-filings-agent/index.js";
import { applyEntityType, enforcementCases, ownershipFrom } from "../agents/orchestrator/index.js";
import { investsIn } from "../agents/corporate-agent/index.js";
import { sameFacts, spelledOut, unsupportedDetail, type Fact } from "../agents/synthesis-agent/index.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { ResearchBundle } from "../types/research.js";

const bundle = (over: Partial<ResearchBundle>): ResearchBundle => ({
  query: "x", generatedAt: "", company: { name: "x" }, leadership: [], products: [], news: [], funding: [], competitors: [], sources: [], ...over,
}) as ResearchBundle;

describe("round nine: risks (fix 78)", () => {
  it("OSHA inspection records naming the company are kept, as inspections", () => {
    const r = { title: "Inspection Detail", snippet: "Establishment: ACCO Engineered Systems, Inc. Site: Pasadena", url: "https://www.osha.gov/ords/imis/establishment.inspection_detail?id=1234567.015" };
    assert.equal(isEnforcementAction(r, ["ACCO Engineered Systems"]), true);
    assert.equal(isEnforcementAction({ ...r, snippet: "Establishment: Other Mechanical LLC" }, ["ACCO Engineered Systems"]), false);
    const [c] = enforcementCases([{ headline: r.title, url: r.url, enforcement: true }], ["ACCO Engineered Systems"]);
    assert.equal(c.caseType, "OSHA inspection");
    assert.notEqual(c.role, "charged");
  });

  it("a court written out in full matches its abbreviation", () => {
    assert.match(spelledOut("District Court, W.D. Washington"), /Western District/);
    assert.match(spelledOut("Location: Monument, CO"), /Colorado/);
    const facts: Fact[] = [{ text: "Case: Northwest Administrators Inc v. Acco Engineered Systems Inc (District Court, W.D. Washington, filed 2026-03-01, company is the defendant)", url: "u" }];
    assert.equal(unsupportedDetail("ACCO is the defendant in a suit by Northwest Administrators in the Western District of Washington.", [1], facts, "ACCO Engineered Systems"), undefined);
    // Still catches a detail no fact gives (fix 59).
    assert.equal(unsupportedDetail("ACCO faces a California suit from Northwest Administrators.", [1], facts, "ACCO Engineered Systems"), "California");
  });

  it("a risk on exactly an opportunity's facts is the same item", () => {
    assert.equal(sameFacts([2, 1], [1, 2]), true);
    assert.equal(sameFacts([1], [1, 2]), false);
  });

  it("an analysis with no real risks says so", () => {
    const report = new ReportAgent().generate(bundle({ company: { name: "MJW Investments" }, risks: [], opportunities: [] }));
    assert.match(report, /No material risks found in the records reviewed/);
    const none = new ReportAgent().generate(bundle({ company: { name: "MJW Investments" } }));
    assert.match(none, /Insufficient data for risk analysis/);
  });
});

describe("round nine: leadership (fixes 78, 82)", () => {
  it("only people's names are leadership", () => {
    assert.equal(isPersonName("New Senior Vice / President"), false);
    assert.equal(isPersonName("Meet Our Team"), false);
    assert.equal(isPersonName("Karen Richard"), true);
    assert.equal(isPersonName("Dr. Lilia Agadganian, M.S."), true);
    assert.equal(isPersonName("Ludwig van Beethoven"), true);
  });

  it("district managers drop once an executive is listed", () => {
    const ranked = rankLeadership([
      { name: "Pat Lee", title: "District Manager" }, { name: "Kathleen Mazzarella", title: "Chairman, President and CEO" },
    ]);
    assert.deepEqual(ranked.map((l) => l.name), ["Kathleen Mazzarella"]);
  });
});

describe("round nine: funding and ownership (fixes 57, 64, 78)", () => {
  it("a round the company invested in isn't its own", () => {
    assert.equal(investsIn("Patagonia and H&M invest in biomanufacturing startup Rubi", "Patagonia"), true);
    assert.equal(investsIn("Meati closes $100M round led by Tin Shed Ventures and Patagonia", "Patagonia"), true);
    assert.equal(investsIn("Gecko Robotics raises $125M Series D led by USIT", "Gecko Robotics"), false);
  });

  it("finds trust and employee ownership", () => {
    assert.equal(ownershipFrom([{ text: "Outdoorwear manufacturer - owned by a non profit corporations since 2022, the Patagonia Purpose Trust and Holdfast Collective", url: "u" }])?.note,
      "Owned by the Patagonia Purpose Trust and Holdfast Collective");
    assert.equal(ownershipFrom([{ text: "ACCO is a 100% employee-owned ESOP company", url: "u" }])?.note, "Employee-owned (ESOP)");
  });

  it("a company owned by a trust or its employees keeps no investor rounds", () => {
    const b = bundle({ company: { name: "Patagonia" }, ownership: "Owned by the Patagonia Purpose Trust and Holdfast Collective",
      funding: [{ round: "Other Equity in Circ", amount: "$8M" }, { round: "Seed", amount: "$8.7M" }] });
    applyEntityType(b, false);
    assert.deepEqual(b.funding, []);
  });
});

describe("round nine: courts (fixes 67, 82)", () => {
  it("a bare short name is no party; the whole name alone still is", () => {
    const andersen = ["Andersen Windows & Doors", "Andersen Corporation", "Andersen"];
    assert.equal(namedParty("Smith v. Andersen", andersen), false);
    assert.equal(namedParty("Smith v. Andersen Corporation", andersen), true);
    assert.equal(namedParty("Patagonia v. United States", ["Patagonia"]), true);
    assert.equal(namedParty("Doe v. Limbach Company LLC", ["Limbach Holdings"]), true);
  });

  it("an open case over three years old is unverified and ranks below current ones", () => {
    const now = Date.parse("2026-10-23");
    const old = caseContext({ caseName: "Doe v. Andersen Corporation", dateFiled: "2019-05-01" }, ["Andersen Corporation"], now);
    assert.equal(old.status, "status unverified");
    assert.equal(caseContext({ caseName: "Doe v. Andersen Corporation", dateFiled: "2025-05-01" }, ["Andersen Corporation"], now).status, "open");
    const cases: CaseRecord[] = [
      { caption: "Old v. Andersen Corporation", url: "a", filed: "2019-05-01", role: "defendant", status: "status unverified" },
      { caption: "New v. Andersen Corporation", url: "b", filed: "2025-05-01", role: "defendant", status: "open" },
    ];
    assert.equal(rankCases(cases)[0].url, "b");
  });
});

describe("round nine: names and corporate actions (fixes 79, 80)", () => {
  it("a name with \"&\" matches itself", () => {
    assert.equal(mentionsCompany("Andersen Windows & Doors | Official Site", "Andersen Windows & Doors"), true);
  });

  it("acquisitions and brands come out of news and its own pages", () => {
    const acts = corporateActions([
      { text: "Andersen Corporation acquires Bright Wood Corporation", url: "a", date: "Mar 2025" },
      { text: "Renewal by Andersen, a subsidiary of Andersen Corporation, opens a showroom", url: "b" },
      { text: "Limbach Holdings completes acquisition of Pioneer Power and 1901 Group", url: "c" },
    ], ["Andersen Corporation", "Limbach Holdings"]);
    assert.deepEqual(acts.map((a) => `${a.kind}: ${a.name}`),
      ["Acquisition: Bright Wood Corporation", "Subsidiary or brand: Renewal by Andersen", "Acquisition: Pioneer Power", "Acquisition: 1901 Group"]);
  });
});
