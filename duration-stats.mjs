// Task 2.3 — prints median/p90 research-run duration for the last N
// completed runs. Standalone script rather than an admin API endpoint:
// no new auth/admin-gating surface needed for something you'd run from a
// terminal, not click in the app. Usage: node duration-stats.mjs [N]
// (default 200), or `npm run duration-stats -- 500`.
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

const { data, error } = await supabase
  .from("research_runs")
  .select("duration_ms, type, tier")
  .eq("status", "completed")
  .not("duration_ms", "is", null)
  .order("generated_at", { ascending: false })
  .limit(N);

if (error) {
  if (error.code === "42703") {
    console.error(
      "[duration-stats] research_runs.duration_ms doesn't exist yet — run the " +
      '"Run duration / cost logging (Phase 2 task 2.3)" migration block in ' +
      "supabase/schema.sql (Supabase SQL Editor) first."
    );
  } else {
    console.error("[duration-stats] query failed:", error);
  }
  process.exitCode = 1;
} else if (!data || data.length === 0) {
  console.log(`[duration-stats] No completed runs with duration_ms recorded yet — ` +
    `this column only started populating with Phase 2 (task 2.3); older runs have none.`);
} else {
  const durations = data.map((r) => r.duration_ms).sort((a, b) => a - b);
  const median = percentile(durations, 50);
  const p90 = percentile(durations, 90);

  console.log(`[duration-stats] Last ${data.length} completed run(s) with a recorded duration:`);
  console.log(`  median: ${(median / 1000).toFixed(1)}s`);
  console.log(`  p90:    ${(p90 / 1000).toFixed(1)}s`);
  console.log(`  min:    ${(durations[0] / 1000).toFixed(1)}s`);
  console.log(`  max:    ${(durations[durations.length - 1] / 1000).toFixed(1)}s`);
}
