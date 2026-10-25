import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOwnershipNote, parentOnlyInOtherFilings } from "./entity-type.js";
import { composeSummary } from "./summary.js";
import type { ResearchBundle } from "../types/research.js";

const ARGAN = "ACCO Dispute Gemma Power Systems California, Inc. (“GPS CA,” a wholly owned subsidiary of Argan) from ACCO Engineered Systems, Inc. approximately $663,000. ...";

describe("round nineteen: no other filer's text in a summary", () => {
  it("an ownership note is a short note, never a pasted passage (ACCO)", () => {
    assert.equal(isOwnershipNote(ARGAN), false);
    for (const n of ["Employee-owned (ESOP)", "Employee owned", "Owned by the Patagonia Purpose Trust and Holdfast Collective", "Subsidiary of VF Corporation", "Wholly-owned subsidiary of 1347 Capital"]) {
      assert.equal(isOwnershipNote(n), true, n);
    }
  });

  it("a parent only another company's SEC filing names is dropped", () => {
    const filing = { url: "https://www.sec.gov/Archives/edgar/data/100517/x.htm", text: "GPS CA, a wholly owned subsidiary of Argan, disputes ACCO Engineered Systems" };
    assert.equal(parentOnlyInOtherFilings("Subsidiary of Argan", [filing]), true);
    assert.equal(parentOnlyInOtherFilings("Subsidiary of Argan", [filing, { url: "https://news.example/a", text: "ACCO, a subsidiary of Argan" }]), false);
  });

  it("the summary skips an ownership value that isn't a note", () => {
    const s = composeSummary({
      query: "x", generatedAt: "2026-10-25T00:00:00Z", leadership: [], products: [], news: [], funding: [], competitors: [], sources: [],
      company: { name: "ACCO Engineered Systems", description: "ACCO Engineered Systems designs HVAC systems.", founded: "1934", headquarters: "Pasadena, CA" },
      ownership: ARGAN,
    } as ResearchBundle) ?? "";
    assert.doesNotMatch(s, /Argan|Gemma|663/);
  });
});
