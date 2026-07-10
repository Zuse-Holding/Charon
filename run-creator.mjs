import { runCreatorAgent } from "./src/agents/creator-agent/index.js";

runCreatorAgent()
  .then((results) => {
    console.log(`[run-creator] Done — ${results.length} creator snapshot(s) written.`);
  })
  .catch((err) => {
    console.error("[run-creator] Failed:", err);
    process.exitCode = 1;
  });
