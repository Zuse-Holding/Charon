import "dotenv/config";
import { runCreatorDiscoveryAgent } from "./src/agents/creator-discovery-agent/index.js";

runCreatorDiscoveryAgent()
  .then((outcomes) => {
    const totalNew = outcomes.reduce((s, o) => s + o.newCandidates, 0);
    console.log(`[run-creator-discovery] Done — ${totalNew} new candidate(s).`);
  })
  .catch((err) => {
    console.error("[run-creator-discovery] Failed:", err);
    process.exitCode = 1;
  });
