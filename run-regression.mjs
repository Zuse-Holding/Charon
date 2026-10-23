/**
 * Launch fix 74: the scorecard companies, run and scored the same way
 * every time. Each report is saved under regression/runs/<timestamp>/, with
 * a summary of run time, cost and every must-find and must-keep check; a
 * must-keep item that passed last run and fails now is flagged.
 *
 *   npm run regression                 all companies
 *   npm run regression -- Graybar Crumbl   only names containing these
 *
 * Runs with Pro-level sources (sanctions, courts, Form D) and whatever
 * keys the environment has; run it where the production keys are set.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ResearchOrchestrator } from "./src/agents/orchestrator/index.ts";
import { withCostTracking } from "./src/lib/cost-tracking.ts";

const ROOT = "regression";
const { companies } = JSON.parse(readFileSync(join(ROOT, "companies.json"), "utf8"));
const only = process.argv.slice(2).map((a) => a.toLowerCase());
const picked = only.length ? companies.filter((c) => only.some((o) => c.name.toLowerCase().includes(o))) : companies;

const runsDir = join(ROOT, "runs");
mkdirSync(runsDir, { recursive: true });
const previous = readdirSync(runsDir).filter((d) => existsSync(join(runsDir, d, "summary.json"))).sort().pop();
const before = previous ? JSON.parse(readFileSync(join(runsDir, previous, "summary.json"), "utf8")) : { companies: {} };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(runsDir, stamp);
mkdirSync(out, { recursive: true });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const check = (report, pattern) => new RegExp(pattern, "im").test(report);
const summary = { startedAt: new Date().toISOString(), companies: {} };
const orchestrator = new ResearchOrchestrator();

for (const c of picked) {
  const started = Date.now();
  console.log(`\n=== ${c.name} (${c.website}) ===`);
  let report = "";
  let costUsd = null;
  let error;
  try {
    const run = await withCostTracking(() => orchestrator.researchCompany(c.name, true, false, { anchor: { website: `https://${c.website}` } }));
    report = run.result.report;
    costUsd = run.totalCostUsd;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(out, `${slug(c.name)}.md`), report || `Run failed: ${error}`);
  const score = (checks) => Object.fromEntries(Object.entries(checks ?? {}).map(([k, p]) => [k, !!report && check(report, p)]));
  const found = score(c.mustFind);
  const kept = score(c.mustKeep);
  const was = before.companies[c.name]?.mustKeep ?? {};
  const lost = Object.keys(kept).filter((k) => was[k] === true && !kept[k]);
  summary.companies[c.name] = { seconds, costUsd, error, mustFind: found, mustKeep: kept, lostSinceLastRun: lost };
  const n = (o) => `${Object.values(o).filter(Boolean).length}/${Object.keys(o).length}`;
  console.log(`${c.name}: must find ${n(found)}, must keep ${n(kept)}, ${seconds}s, $${(costUsd ?? 0).toFixed(3)}${error ? `, ERROR ${error}` : ""}`);
  for (const [k, ok] of Object.entries(found)) if (!ok) console.log(`  missing: ${k}`);
  for (const k of lost) console.log(`  REGRESSION (kept last run, missing now): ${k}`);
}

summary.finishedAt = new Date().toISOString();
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nSaved to ${out}${previous ? ` (compared with ${previous})` : ""}`);
const regressions = Object.values(summary.companies).reduce((n, c) => n + c.lostSinceLastRun.length, 0);
process.exit(regressions > 0 ? 1 : 0);
