// Task 2.3 (duration) + task C (cost) — prints median/p90 duration and
// cost per run for the last N completed quick profiles and Deep Dives.
// Standalone script rather than an admin API endpoint: no new auth/admin-
// gating surface needed for something you'd run from a terminal, not
// click in the app. Usage: node duration-stats.mjs [N] (default 200), or
// `npm run duration-stats -- 500`.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const N = Number(process.argv[2]) || 200;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function printDurationStats(label, rows) {
  const durations = rows.map((r) => r.duration_ms).filter((d) => d != null).sort((a, b) => a - b);
  if (durations.length === 0) {
    console.log(`  No ${label} with a recorded duration yet.`);
    return;
  }
  console.log(`  Duration (${durations.length} run(s) with a recorded value):`);
  console.log(`    median: ${(percentile(durations, 50) / 1000).toFixed(1)}s`);
  console.log(`    p90:    ${(percentile(durations, 90) / 1000).toFixed(1)}s`);
  console.log(`    min:    ${(durations[0] / 1000).toFixed(1)}s`);
  console.log(`    max:    ${(durations[durations.length - 1] / 1000).toFixed(1)}s`);
}

function printCostStats(label, rows) {
  // Rows with cost_usd === null had zero tracked LLM calls (an easter-egg
  // report, or a run before task C shipped) — excluded rather than
  // treated as $0, so the average isn't dragged down by runs that were
  // never actually measured. See src/lib/cost-tracking.ts.
  const costs = rows.map((r) => r.cost_usd).filter((c) => c != null).sort((a, b) => a - b);
  if (costs.length === 0) {
    console.log(`  No ${label} with a recorded cost yet.`);
    return;
  }
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  console.log(`  Cost (${costs.length} run(s) with a recorded value; $0 entries mean real, tracked, zero-cost calls — e.g. Ollama or an OpenRouter free model, not "unmeasured"):`);
  console.log(`    median: $${percentile(costs, 50).toFixed(4)}`);
  console.log(`    mean:   $${mean.toFixed(4)}`);
  console.log(`    max:    $${costs[costs.length - 1].toFixed(4)}`);
}

const { data: quickProfiles, error: qpError } = await supabase
  .from("research_runs")
  .select("duration_ms, cost_usd, type, tier")
  .eq("status", "completed")
  .order("generated_at", { ascending: false })
  .limit(N);

const { data: deepDives, error: ddError } = await supabase
  .from("deep_dives")
  .select("duration_ms, cost_usd")
  .order("generated_at", { ascending: false })
  .limit(N);

function handleMissingColumn(error, table, migrationBlock) {
  if (!error) return false;
  if (error.code === "42703") {
    console.error(
      `[duration-stats] ${table} is missing a column this script needs — run the ` +
      `"${migrationBlock}" migration block in supabase/schema.sql (Supabase SQL Editor) first.`
    );
  } else {
    console.error(`[duration-stats] ${table} query failed:`, error);
  }
  return true;
}

let failed = false;
failed = handleMissingColumn(qpError, "research_runs", "Run duration / cost logging (Phase 2 task 2.3)") || failed;
failed = handleMissingColumn(ddError, "deep_dives", "Run duration / cost logging (Phase 2 task 2.3)") || failed;
if (failed) process.exit(1);

console.log(`Quick profiles — last ${quickProfiles.length} completed run(s):`);
printDurationStats("quick profiles", quickProfiles);
printCostStats("quick profiles", quickProfiles);

console.log(`\nDeep Dives — last ${deepDives.length} run(s):`);
printDurationStats("Deep Dives", deepDives);
printCostStats("Deep Dives", deepDives);
