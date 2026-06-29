/**
 * ════════════════════════════════════════════════════════════════
 * ENTITY EXTRACTION — SNIPPETS TO PASTE INTO EXISTING FILES
 * ════════════════════════════════════════════════════════════════
 *
 *
 * ── 1. web/app/page.tsx ──────────────────────────────────────
 *
 * ADD state (near the other useState hooks):
 *
 *   const [extracting, setExtracting] = useState(false);
 *
 *
 * ADD handler (after the confirmDelete function):
 *
 *   async function handleExtractEntities() {
 *     if (!selected || extracting) return;
 *     setExtracting(true);
 *     try {
 *       const res = await fetch("/api/extract-entities", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({ subject: selected.subject, runId: selected.id }),
 *       });
 *       const data = await res.json();
 *       if (res.ok) {
 *         setStatus(`✓ Extracted ${data.entityCount} entities, ${data.relationshipCount} relationships`);
 *         setTimeout(() => setStatus(""), 5000);
 *       } else {
 *         setStatus(`✗ ${data.error ?? "Entity extraction failed"}`);
 *         setTimeout(() => setStatus(""), 6000);
 *       }
 *     } catch {
 *       setStatus("✗ Entity extraction failed");
 *       setTimeout(() => setStatus(""), 4000);
 *     } finally {
 *       setExtracting(false);
 *     }
 *   }
 *
 *
 * ADD button in the reportActions div (before "Export .md"):
 *
 *   <button
 *     className={styles.actionBtn}
 *     onClick={handleExtractEntities}
 *     disabled={extracting || loading}
 *     title="Extract entities and relationships → Knowledge Graph"
 *   >
 *     {extracting ? "Extracting..." : "Extract Entities ◉"}
 *   </button>
 *
 *
 * ── 2. src/cli.ts ─────────────────────────────────────────────
 *
 * ADD import at top (after existing imports):
 *
 *   import { EntityAgent } from "./agents/entity-agent/index.js";
 *   import { saveEntityGraph } from "./database/entity-store.js";
 *
 *
 * ADD CLI command (after the research-product command):
 *
 *   program
 *     .command("extract-entities")
 *     .argument("<subject>")
 *     .description("Extract entities and relationships from a research report")
 *     .option("-t, --type <type>", "company | person | product", "company")
 *     .action(async (subject: string, opts: { type: RunType }) => {
 *       console.log(`Extracting entities for "${subject}"...`);
 *       logLLMProvider();
 *       const run = findLatestByName(subject, opts.type);
 *       if (!run || !run.bundle) {
 *         console.error(`No research data found for "${subject}". Run research first.`);
 *         process.exit(1);
 *       }
 *       const agent = new EntityAgent();
 *       const graphData = await agent.run(run.bundle as import("./types/research.js").ResearchBundle);
 *       const saved = saveEntityGraph({ ...graphData, runId: run.id });
 *       console.log(
 *         `✓ Extracted ${saved.entities.length} entities, ${saved.relationships.length} relationships`
 *       );
 *       console.log(`  Saved to: database/entity-graphs.json`);
 *     });
 *
 */

export {};
