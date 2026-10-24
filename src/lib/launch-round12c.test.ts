import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ownershipFrom } from "../agents/orchestrator/index.js";

const owner = (text: string, names: string[]) => ownershipFrom([{ text, url: "u" }], names)?.note;

describe("round twelve (c): owner check (fix 92)", () => {
  it("an owner whose name contains the company's is a real owner", () => {
    assert.equal(owner("Patagonia is owned by the Patagonia Purpose Trust and Holdfast Collective.", ["Patagonia"]),
      "Owned by the Patagonia Purpose Trust and Holdfast Collective");
  });

  it("a private-equity owner is a real owner", () => {
    assert.equal(owner("ACCO is owned by Private Equity firm Blackstone.", ["ACCO Engineered Systems"]), "Owned by Private Equity firm Blackstone");
  });

  it("a funding round or the company itself is still a misread", () => {
    assert.equal(owner("It is owned by Series Gecko Robotics and investors.", ["Gecko Robotics"]), undefined);
    assert.equal(owner("The company is owned by Gecko Robotics, Inc.", ["Gecko Robotics"]), undefined);
    assert.equal(owner("Graybar is owned by its employees.", ["Graybar Electric Company"]), "Employee-owned");
  });
});
