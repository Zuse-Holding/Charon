import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEnabled } from "./flags.js";

describe("feature flags", () => {
  it("are off unless explicitly turned on", () => {
    assert.equal(isEnabled("provenance", {}), false);
    assert.equal(isEnabled("provenance", { FEATURE_PROVENANCE: "" }), false);
    assert.equal(isEnabled("provenance", { FEATURE_PROVENANCE: "off" }), false);
    assert.equal(isEnabled("provenance", { FEATURE_PROVENANCE: "yes please" }), false);
  });

  it("accept on, true and 1", () => {
    for (const v of ["on", "true", "1", " ON "]) {
      assert.equal(isEnabled("provenance", { FEATURE_PROVENANCE: v }), true, v);
    }
  });
});
