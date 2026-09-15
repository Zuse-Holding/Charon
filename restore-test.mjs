// Task 4.5 — verifies a Supabase backup file actually restores, instead of
// trusting that a backup exists just because Supabase's dashboard says
// backups are enabled. Shells out to pg_restore/psql (the standard tools
// Supabase's own docs point at for this) rather than adding a "pg" npm
// dependency just to open a connection — this script's only job is to
// drive those CLIs and sanity-check what came out the other end.
//
// SAFETY: this is a destructive operation against whatever RESTORE_TARGET_
// DATABASE_URL points at (pg_restore/psql write into it directly) — it
// must point at a disposable scratch Postgres instance, never at
// production or any database anyone depends on. Two guards enforce that:
//   1. Refuses to run at all if the target host matches the project's own
//      NEXT_PUBLIC_SUPABASE_URL host — the most likely accidental-target
//      mistake (pasting the real project's connection string instead of a
//      scratch one).
//   2. Refuses to run if the target database already has any of this
//      app's tables in it — a scratch DB should be empty; one that
//      already has research_runs etc. in it is probably the real thing.
//
// Usage:
//   RESTORE_TARGET_DATABASE_URL=postgres://user:pass@host:5432/scratch \
//   BACKUP_FILE=/path/to/backup.dump \
//   node restore-test.mjs
//
// BACKUP_FILE can be either a pg_dump custom-format file (.dump/.backup —
// uses pg_restore) or a plain .sql file (uses psql). Detected by extension;
// override with FORMAT=custom|plain if the extension doesn't match.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const TARGET_URL = process.env.RESTORE_TARGET_DATABASE_URL;
const BACKUP_FILE = process.env.BACKUP_FILE;

if (!TARGET_URL || !BACKUP_FILE) {
  console.error(
    "Usage: RESTORE_TARGET_DATABASE_URL=postgres://... BACKUP_FILE=path/to/backup.dump node restore-test.mjs"
  );
  process.exit(1);
}

if (!existsSync(BACKUP_FILE)) {
  console.error(`BACKUP_FILE not found: ${BACKUP_FILE}`);
  process.exit(1);
}

// Guard 1 — refuse if this looks like the real project.
const realSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (realSupabaseUrl) {
  try {
    const realHost = new URL(realSupabaseUrl).hostname.replace(/^db\./, "");
    if (TARGET_URL.includes(realHost)) {
      console.error(
        `RESTORE_TARGET_DATABASE_URL appears to point at this project's real Supabase host (${realHost}). ` +
        `Refusing to run — this script must only ever target a disposable scratch database.`
      );
      process.exit(1);
    }
  } catch {
    // NEXT_PUBLIC_SUPABASE_URL isn't a valid URL — nothing to compare against, keep going.
  }
}

function psql(sql) {
  return spawnSync("psql", [TARGET_URL, "-t", "-A", "-c", sql], { encoding: "utf-8" });
}

// Guard 2 — refuse if the target already looks like a real, populated
// database rather than an empty scratch one.
const preCheck = psql(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' " +
  "AND table_name IN ('research_runs', 'profiles', 'watchlist', 'deep_dives')"
);
if (preCheck.error) {
  console.error(
    "Couldn't run psql against RESTORE_TARGET_DATABASE_URL — is the psql client installed and on PATH, " +
    "and is the connection string reachable?", preCheck.error
  );
  process.exit(1);
}
const existingTables = preCheck.stdout.trim().split("\n").filter(Boolean);
if (existingTables.length > 0) {
  console.error(
    `Target database already has app tables in it (${existingTables.join(", ")}). ` +
    `Refusing to restore on top of a non-empty database — point this at a fresh scratch instance.`
  );
  process.exit(1);
}

// Restore.
const isPlainSql = (process.env.FORMAT ?? (BACKUP_FILE.endsWith(".sql") ? "plain" : "custom")) === "plain";
console.log(`Restoring ${BACKUP_FILE} (${isPlainSql ? "plain SQL" : "pg_dump custom format"}) into scratch target...`);

const restoreResult = isPlainSql
  ? spawnSync("psql", [TARGET_URL, "-f", BACKUP_FILE], { encoding: "utf-8", stdio: "inherit" })
  : spawnSync("pg_restore", ["--no-owner", "--no-privileges", "-d", TARGET_URL, BACKUP_FILE], { encoding: "utf-8", stdio: "inherit" });

if (restoreResult.error || restoreResult.status !== 0) {
  console.error("Restore failed — see output above. Backup file may be corrupt or incompatible.");
  process.exit(1);
}

// Sanity-check: the tables exist post-restore and have rows in at least
// one of them (an empty-but-present schema could still mean the actual
// data didn't come through).
console.log("\nRestore completed. Checking row counts:");
const TABLES = ["research_runs", "profiles", "watchlist", "deep_dives"];
let anyRows = false;
for (const table of TABLES) {
  const result = psql(`SELECT COUNT(*) FROM ${table}`);
  if (result.status !== 0) {
    console.log(`  ${table}: table missing or query failed — ${result.stderr?.trim()}`);
    continue;
  }
  const count = Number(result.stdout.trim());
  console.log(`  ${table}: ${count} row(s)`);
  if (count > 0) anyRows = true;
}

if (!anyRows) {
  console.error(
    "\nWARNING: every table restored empty. Either the source backup was taken from an empty " +
    "database, or something didn't actually come through — don't treat this as a passing restore test."
  );
  process.exit(1);
}

console.log("\nRestore test passed — backup file is restorable and contains data.");
console.log("Remember to drop/reset the scratch database before the next test run.");
