import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recipientMatches } from "./index.js";

describe("recipientMatches", () => {
  it("rejects namesakes that only contain the name (the Stripe report, 2026-10-05)", () => {
    assert.equal(recipientMatches("STRIPES GLOBAL, INC.", ["stripe"]), false);
    assert.equal(recipientMatches("STATEWIDE STRIPES, INC.", ["stripe"]), false);
    assert.equal(recipientMatches("PINSTRIPE LLC", ["stripe"]), false);
  });

  it("accepts the company under its registered name", () => {
    assert.equal(recipientMatches("STRIPE, INC.", ["stripe"]), true);
    assert.equal(recipientMatches("RAYTHEON COMPANY", ["raytheon", "rtx corporation"]), true);
    assert.equal(recipientMatches("RTX CORPORATION", ["raytheon", "rtx corporation"]), true);
  });

  it("accepts a recipient that is the company name minus a suffix", () => {
    assert.equal(recipientMatches("LOCKHEED MARTIN", ["lockheed martin corporation"]), true);
  });

  it("never matches a blank recipient", () => {
    assert.equal(recipientMatches("", ["stripe"]), false);
    assert.equal(recipientMatches(null, ["stripe"]), false);
    assert.equal(recipientMatches("  ,. ", ["stripe"]), false);
  });
});
