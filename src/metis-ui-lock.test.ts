// web/metis-ui is the source of truth for every Metis site's header, footer,
// states and tokens, copied into committee-app by scripts/sync-metis-ui.mjs.
// Its lock must match its files, so a change can't land without running the
// sync script (which rewrites the lock and copies it over).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "web", "metis-ui");

// Same hash as scripts/sync-metis-ui.mjs hashDir.
function hashDir(dir: string): string {
  const files = readdirSync(dir).filter((f) => f !== "metis-ui.lock" && !f.endsWith(".test.ts")).sort();
  const h = createHash("sha256");
  for (const f of files) h.update(f).update("\0").update(readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n")).update("\0");
  return h.digest("hex");
}

test("metis-ui.lock matches web/metis-ui (run node scripts/sync-metis-ui.mjs after editing)", () => {
  assert.equal(readFileSync(join(DIR, "metis-ui.lock"), "utf8").trim(), hashDir(DIR));
});
