// Ratchet on one-off empty / error / limit states (UX doc: "ban one-off
// empty states"). New ones must use the shared StateView (web/metis-ui) or
// EmptyState. This counts the legacy inline ones in the web app and fails if
// the number grows; lower BASELINE when you convert some.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASELINE = 16; // 2026-10-17

const PATTERN = /<(p|div|span|td)\b[^>]*>\s*(No |Nothing |Couldn['’]t |Could not |Something went wrong|Failed to )[^<{]{0,120}</g;

function countInlineStates(dir: string): number {
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules" || f === "metis-ui" || f.startsWith(".")) continue;
    if (statSync(p).isDirectory()) n += countInlineStates(p);
    else if (/\.(tsx|jsx)$/.test(f)) n += (readFileSync(p, "utf8").match(PATTERN) ?? []).length;
  }
  return n;
}

test("no new one-off inline empty/error states (use StateView or EmptyState)", () => {
  const web = join(process.cwd(), "web");
  const n = countInlineStates(join(web, "app")) + countInlineStates(join(web, "components"));
  assert.ok(n <= BASELINE, `${n} inline states (baseline ${BASELINE}). Use StateView / EmptyState for new ones.`);
});
