#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import "dotenv/config";
import { ResearchOrchestrator } from "./agents/orchestrator/index.js";
import {
  recordRun,
  listRecent,
  findLatestByName,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getStaleWatchlistEntries,
  RunType,
} from "./database/store.js";

const program = new Command();

program
  .name("seline")
  .description("SELINE INTEL — AI-powered research CLI")
  .version("0.1.0");

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function warnIfNoSearchKey() {
  if (!process.env.SERPER_API_KEY) {
    console.log("  (no SERPER_API_KEY — degraded mode: direct-site fetch only)");
  }
}

function logLLMProvider() {
  const provider = process.env.LLM_PROVIDER ??
    (process.env.GROQ_API_KEY ? "groq" : "ollama");
  console.log(`  LLM: ${provider.toUpperCase()}`);
}

// ── research ──────────────────────────────────────────────────────────
program
  .command("research")
  .argument("<company>")
  .description("Research a company")
  .action(async (company: string) => {
    console.log(`Researching company "${company}"...`);
    warnIfNoSearchKey(); logLLMProvider();
    const orchestrator = new ResearchOrchestrator();
    const { bundle, report } = await orchestrator.researchCompany(company);
    const dir = join(process.cwd(), "reports");
    mkdirSync(dir, { recursive: true });
    const outPath = join(dir, `${slugify(company)}.md`);
    writeFileSync(outPath, report, "utf-8");
    recordRun({ id: randomUUID(), type: "company", subject: company, generatedAt: bundle.generatedAt, reportPath: outPath, bundle });
    console.log(`Report written to ${outPath}`);
  });

// ── research-person ───────────────────────────────────────────────────
program
  .command("research-person")
  .argument("<name>")
  .description("Research a person")
  .action(async (name: string) => {
    console.log(`Researching person "${name}"...`);
    warnIfNoSearchKey(); logLLMProvider();
    const orchestrator = new ResearchOrchestrator();
    const { bundle, report } = await orchestrator.researchPerson(name);
    const dir = join(process.cwd(), "reports", "people");
    mkdirSync(dir, { recursive: true });
    const outPath = join(dir, `${slugify(name)}.md`);
    writeFileSync(outPath, report, "utf-8");
    recordRun({ id: randomUUID(), type: "person", subject: name, generatedAt: bundle.generatedAt, reportPath: outPath, bundle });
    console.log(`Report written to ${outPath}`);
  });

// ── research-product ──────────────────────────────────────────────────
program
  .command("research-product")
  .argument("<product>")
  .description("Research a specific product (e.g. \"Tesla Model 3\")")
  .action(async (product: string) => {
    console.log(`Researching product "${product}"...`);
    warnIfNoSearchKey(); logLLMProvider();
    const orchestrator = new ResearchOrchestrator();
    const { bundle, report } = await orchestrator.researchProduct(product);
    const dir = join(process.cwd(), "reports", "products");
    mkdirSync(dir, { recursive: true });
    const outPath = join(dir, `${slugify(product)}.md`);
    writeFileSync(outPath, report, "utf-8");
    recordRun({ id: randomUUID(), type: "product", subject: product, generatedAt: bundle.generatedAt, reportPath: outPath, bundle });
    console.log(`Report written to ${outPath}`);
  });

// ── list ──────────────────────────────────────────────────────────────
program
  .command("list")
  .description("List recent research runs")
  .option("-n, --number <count>", "how many to show", "10")
  .option("-t, --type <type>", "filter by type: company | person | product")
  .action((opts: { number: string; type?: RunType }) => {
    const runs = listRecent(parseInt(opts.number, 10), opts.type);
    if (runs.length === 0) {
      console.log('No research runs yet. Try: seline research "Company Name"');
      return;
    }
    console.log(`\nRecent research runs:\n`);
    for (const r of runs) {
      console.log(`  [${r.type}] ${r.subject}  —  ${r.generatedAt}`);
    }
  });

// ── show ──────────────────────────────────────────────────────────────
program
  .command("show")
  .argument("<subject>")
  .description("Print the most recent saved report")
  .option("-t, --type <type>")
  .action((subject: string, opts: { type?: RunType }) => {
    const run = findLatestByName(subject, opts.type);
    if (!run) { console.log(`No saved research for "${subject}".`); return; }
    if (!existsSync(run.reportPath)) { console.log(`Report file missing: ${run.reportPath}`); return; }
    console.log(readFileSync(run.reportPath, "utf-8"));
  });

// ── deep-dive ─────────────────────────────────────────────────────────
program
  .command("deep-dive")
  .argument("<company>")
  .description("Run a 10-section Tier 2 deep dive analysis on a company")
  .action(async (company: string) => {
    console.error(`Running deep dive on "${company}"...`);
    warnIfNoSearchKey(); logLLMProvider();

    const { DeepDiveAgent } = await import("./agents/deep-dive/index.js");
    const { DirectFetchProvider, SerperSearchProvider } = await import("./lib/providers.js");

    const fetcher  = new DirectFetchProvider();
    const searcher = new SerperSearchProvider();
    const agent    = new DeepDiveAgent(fetcher, searcher);

    const bundle = await agent.run(company, (event) => {
      // Log progress to stderr so stdout stays clean for JSON output
      if (event.type === "section_start") {
        console.error(`  [${event.sectionIndex! + 1}/10] ${event.section}...`);
      }
    });

    // Output JSON to stdout for the API route to parse
    console.log(JSON.stringify(bundle));
  });
program
  .command("watch")
  .argument("<subject>")
  .description("Add a company, person, or product to your Watchlist")
  .option("-t, --type <type>", "company | person | product", "company")
  .option("-d, --days <days>", "refresh interval in days", "3")
  .action((subject: string, opts: { type: RunType; days: string }) => {
    const entry = addToWatchlist(subject, opts.type, parseInt(opts.days, 10));
    console.log(`Added to Watchlist: [${entry.type}] ${entry.subject} (refresh every ${entry.refreshIntervalDays}d)`);
  });

// ── unwatch ───────────────────────────────────────────────────────────
program
  .command("unwatch")
  .argument("<id>", "Watchlist entry ID (from seline watchlist)")
  .description("Remove an entry from your Watchlist")
  .action((id: string) => {
    removeFromWatchlist(id);
    console.log(`Removed ${id} from Watchlist.`);
  });

// ── watchlist ─────────────────────────────────────────────────────────
program
  .command("watchlist")
  .description("Show your Watchlist and staleness status")
  .action(() => {
    const entries = getWatchlist();
    if (entries.length === 0) {
      console.log('Watchlist is empty. Add with: seline watch "Company Name"');
      return;
    }
    const stale = getStaleWatchlistEntries().map((e) => e.id);
    console.log(`\nWatchlist:\n`);
    for (const e of entries) {
      const isStale = stale.includes(e.id);
      const last = e.lastRefreshedAt ?? e.addedAt;
      const ageDays = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
      console.log(`  [${e.type}] ${e.subject}  —  ${isStale ? `STALE (${ageDays}d ago)` : `fresh (${ageDays}d ago)`}  [${e.id}]`);
    }
  });

// ── watchlist-refresh ─────────────────────────────────────────────────
program
  .command("watchlist-refresh")
  .description("Re-run research for all stale Watchlist entries")
  .action(async () => {
    const stale = getStaleWatchlistEntries();
    if (stale.length === 0) { console.log("All Watchlist entries are fresh."); return; }
    console.log(`Refreshing ${stale.length} stale entr${stale.length === 1 ? "y" : "ies"}...`);
    const orchestrator = new ResearchOrchestrator();
    for (const entry of stale) {
      console.log(`  → [${entry.type}] ${entry.subject}`);
      try {
        if (entry.type === "company") {
          const { bundle, report } = await orchestrator.researchCompany(entry.subject);
          const dir = join(process.cwd(), "reports");
          mkdirSync(dir, { recursive: true });
          const outPath = join(dir, `${slugify(entry.subject)}.md`);
          writeFileSync(outPath, report, "utf-8");
          recordRun({ id: randomUUID(), type: "company", subject: entry.subject, generatedAt: bundle.generatedAt, reportPath: outPath, bundle });
        } else if (entry.type === "person") {
          const { bundle, report } = await orchestrator.researchPerson(entry.subject);
          const dir = join(process.cwd(), "reports", "people");
          mkdirSync(dir, { recursive: true });
          const outPath = join(dir, `${slugify(entry.subject)}.md`);
          writeFileSync(outPath, report, "utf-8");
          recordRun({ id: randomUUID(), type: "person", subject: entry.subject, generatedAt: bundle.generatedAt, reportPath: outPath, bundle });
        } else if (entry.type === "product") {
          const { bundle, report } = await orchestrator.researchProduct(entry.subject);
          const dir = join(process.cwd(), "reports", "products");
          mkdirSync(dir, { recursive: true });
          const outPath = join(dir, `${slugify(entry.subject)}.md`);
          writeFileSync(outPath, report, "utf-8");
          recordRun({ id: randomUUID(), type: "product", subject: entry.subject, generatedAt: bundle.generatedAt, reportPath: outPath, bundle });
        }
        console.log(`    ✓ done`);
      } catch (err) {
        console.error(`    ✗ failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log("Watchlist refresh complete.");
  });

program.parseAsync(process.argv);
