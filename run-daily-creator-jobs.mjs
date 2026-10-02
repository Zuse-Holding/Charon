import "dotenv/config";
import { runCreatorSnapshotAgent } from "./src/agents/creator-snapshot-agent/index.js";
import { runCreatorDiscoveryAgent } from "./src/agents/creator-discovery-agent/index.js";
import { runDay7EmailJob } from "./run-day7-email-job.mjs";

// Single entrypoint for the Railway Cron service — runs every daily job
// back to back in one scheduled process (the two creator jobs, then the
// day-7 email), so there's only one cron service to configure. Order between them
// doesn't matter functionally (discovery only queues pending candidates,
// it doesn't touch the watchlist snapshot reads); snapshot runs first
// since it's the existing daily-tracking job, discovery second.
//
// Each stage is wrapped separately so a catastrophic failure in one
// (e.g. the watchlist query itself failing) doesn't prevent the other
// from running — this is an unattended cron process, not an interactive
// run where you'd want to stop and look at the first error.
async function main() {
  let ok = true;

  try {
    console.log("[daily-creator-jobs] Starting creator-snapshot...");
    const outcomes = await runCreatorSnapshotAgent();
    const written = outcomes.filter((o) => o.status === "written").length;
    console.log(`[daily-creator-jobs] creator-snapshot done — ${written}/${outcomes.length} written.`);
  } catch (err) {
    ok = false;
    console.error("[daily-creator-jobs] creator-snapshot failed:", err);
  }

  try {
    console.log("[daily-creator-jobs] Starting creator-discovery...");
    const outcomes = await runCreatorDiscoveryAgent();
    const totalNew = outcomes.reduce((sum, o) => sum + o.newCandidates, 0);
    console.log(`[daily-creator-jobs] creator-discovery done — ${totalNew} new candidate(s).`);
  } catch (err) {
    ok = false;
    console.error("[daily-creator-jobs] creator-discovery failed:", err);
  }

  try {
    console.log("[daily-creator-jobs] Starting day-7 email...");
    if (!(await runDay7EmailJob())) ok = false;
  } catch (err) {
    ok = false;
    console.error("[daily-creator-jobs] day-7 email failed:", err);
  }

  return ok;
}

main()
  .then((ok) => {
    console.log(`[daily-creator-jobs] ${ok ? "All done." : "Finished with errors — see above."}`);
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error("[daily-creator-jobs] Fatal error:", err);
    process.exit(1);
  });
