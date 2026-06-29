/**
 * ADD THIS COMMAND TO src/cli.ts
 *
 * Paste this block anywhere after the existing `research-product`
 * command, before the `list` command.
 *
 * Also ensure these are imported at the top of cli.ts (they likely
 * already are since researchCompanyDeep is on the same orchestrator):
 *   import { ResearchOrchestrator } from "./agents/orchestrator/index.js";
 *   (No new imports needed — DeepDiveBundle is internal to orchestrator)
 */

// ── research-deep ─────────────────────────────────────────────────────
program
  .command("research-deep")
  .argument("<company>")
  .description("Generate a deep dive analyst report for a company (2–5 min)")
  .action(async (company: string) => {
    console.log(`Deep dive analysis: "${company}" — this takes 2–5 minutes...`);
    warnIfNoSearchKey();
    logLLMProvider();

    if (!process.env.GROQ_API_KEY) {
      console.error("  ✗ GROQ_API_KEY required for deep dive analysis.");
      process.exit(1);
    }

    const orchestrator = new ResearchOrchestrator();
    const { bundle, report } = await orchestrator.researchCompanyDeep(company);

    const dir = join(process.cwd(), "reports", "deep-dive");
    mkdirSync(dir, { recursive: true });
    const outPath = join(dir, `${slugify(company)}-deep.md`);
    writeFileSync(outPath, report, "utf-8");

    // Record in store as a company run so it appears in the dashboard feed
    recordRun({
      id: randomUUID(),
      type: "company",
      subject: `${company} [DEEP DIVE]`,
      generatedAt: bundle.generatedAt,
      reportPath: outPath,
      // bundle shape differs from ResearchBundle — cast to any for store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bundle: bundle as any,
    });

    console.log(`✓ Deep dive report written to ${outPath}`);
  });
