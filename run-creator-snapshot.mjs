import "dotenv/config";
import { runCreatorSnapshotAgent } from "./src/agents/creator-snapshot-agent/index.js";

runCreatorSnapshotAgent()
  .then((outcomes) => {
    const written = outcomes.filter((o) => o.status === "written").length;
    console.log(`[run-creator-snapshot] Done — ${written}/${outcomes.length} snapshot(s) written.`);
  })
  .catch((err) => {
    console.error("[run-creator-snapshot] Failed:", err);
    process.exitCode = 1;
  });
