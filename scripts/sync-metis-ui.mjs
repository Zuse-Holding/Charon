#!/usr/bin/env node
// Copies web/metis-ui (the source of truth) into committee-app and writes a
// metis-ui.lock (sha256 of every file) next to each copy and the source.
//
//   node scripts/sync-metis-ui.mjs ../committee-app/committee-app        # sync
//   node scripts/sync-metis-ui.mjs --check ../committee-app/committee-app # report drift, change nothing
//   node scripts/sync-metis-ui.mjs                                        # just refresh the source lock

import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "web", "metis-ui");
const TARGETS = ["cim-redteam/web/metis-ui", "frontend/src/metis-ui"];
const LOCK = "metis-ui.lock";
// Tests run in this repo only; copies get the code, not the tests.
const isShipped = (f) => f !== LOCK && !f.endsWith(".test.ts");

// Keep in step with the lock tests in each repo, which re-implement this
// hash so they don't depend on this script.
export function hashDir(dir) {
  const files = readdirSync(dir).filter(isShipped).sort();
  const h = createHash("sha256");
  for (const f of files) {
    // Normalize line endings so a CRLF checkout hashes the same.
    h.update(f).update("\0").update(readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n")).update("\0");
  }
  return h.digest("hex");
}

function writeLock(dir) {
  writeFileSync(join(dir, LOCK), `${hashDir(dir)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const repo = args.find((a) => !a.startsWith("--"));

  if (!check) writeLock(SOURCE);
  const source = hashDir(SOURCE);
  if (!repo) {
    console.log(`metis-ui source ${source.slice(0, 12)}`);
    return;
  }

  let stale = 0;
  for (const t of TARGETS) {
    const dest = resolve(repo, t);
    if (check) {
      const have = existsSync(dest) ? hashDir(dest) : "missing";
      const ok = have === source;
      if (!ok) stale++;
      console.log(`${ok ? "up to date" : "STALE     "} ${t} (${have.slice(0, 12)} vs ${source.slice(0, 12)})`);
      continue;
    }
    rmSync(dest, { recursive: true, force: true });
    cpSync(SOURCE, dest, { recursive: true, filter: (src) => src === SOURCE || isShipped(src.split(/[\\/]/).pop()) });
    writeLock(dest);
    console.log(`synced ${t} -> ${source.slice(0, 12)}`);
  }
  process.exit(stale ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
