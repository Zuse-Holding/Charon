import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivatePath, safeNext } from "./return-to.js";

test("safeNext keeps same-site paths with their query", () => {
  assert.equal(safeNext("/reports?type=company"), "/reports?type=company");
  assert.equal(safeNext(null), "/app");
});

test("safeNext refuses anything that leaves the site", () => {
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "@evil.com", "evil.com", "/\u0009/evil.com"]) {
    assert.equal(safeNext(bad), "/app", bad);
  }
});

test("private paths match whole segments only", () => {
  assert.equal(isPrivatePath("/reports"), true);
  assert.equal(isPrivatePath("/api/research"), true);
  assert.equal(isPrivatePath("/reportsabc"), false);
  assert.equal(isPrivatePath("/pricing"), false);
});
