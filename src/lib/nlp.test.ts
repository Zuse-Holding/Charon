import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePersonQuery } from "./nlp.js";

describe("parsePersonQuery", () => {
  it("splits a capitalized affiliation (the Michael Jordan test, 2026-10-15)", () => {
    assert.deepEqual(parsePersonQuery("Michael Jordan UC Berkeley"), { name: "Michael Jordan", affiliation: "UC Berkeley" });
    assert.deepEqual(parsePersonQuery("Daniel Olmos CSUN"), { name: "Daniel Olmos", affiliation: "CSUN" });
    assert.deepEqual(parsePersonQuery("Jane Smith Stanford University"), { name: "Jane Smith", affiliation: "Stanford University" });
    assert.deepEqual(parsePersonQuery("Mary Ann Smith Google"), { name: "Mary Ann Smith", affiliation: "Google" });
    assert.deepEqual(parsePersonQuery("Sam Lee Acme Labs"), { name: "Sam Lee", affiliation: "Acme Labs" });
  });

  it("keeps the existing forms working", () => {
    assert.deepEqual(parsePersonQuery("Daniel Olmos csun"), { name: "Daniel Olmos", affiliation: "csun" });
    assert.deepEqual(parsePersonQuery("Jane Smith at Google"), { name: "Jane Smith", affiliation: "Google" });
    assert.deepEqual(parsePersonQuery("Daniel Olmos, CSUN"), { name: "Daniel Olmos", affiliation: "CSUN" });
  });

  it("doesn't split names that only look like they could hold an affiliation", () => {
    assert.deepEqual(parsePersonQuery("Michael Jordan"), { name: "Michael Jordan" });
    assert.deepEqual(parsePersonQuery("Sarah Jessica Parker"), { name: "Sarah Jessica Parker" });
    assert.deepEqual(parsePersonQuery("Martin Luther King III"), { name: "Martin Luther King III" });
    assert.deepEqual(parsePersonQuery("Michael I. Jordan"), { name: "Michael I. Jordan" });
    assert.deepEqual(parsePersonQuery("John Stanford"), { name: "John Stanford" }); // two-word names never split
    assert.deepEqual(parsePersonQuery("michael jordan uc berkeley"), { name: "michael jordan uc berkeley" }); // all-lowercase left alone
  });
});
