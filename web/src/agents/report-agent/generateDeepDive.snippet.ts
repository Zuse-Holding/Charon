  /**
   * Deep Dive Report Generator
   * Formats a DeepDiveBundle (LLM-written prose sections) into a
   * structured markdown document. Add this method to the ReportAgent
   * class, just before the closing brace of the class.
   *
   * INSTALL: Paste this method into src/agents/report-agent/index.ts
   * inside the ReportAgent class, before the final closing `}`.
   * Also add this import at the top of report-agent/index.ts:
   *   import { DeepDiveBundle } from "../deep-dive-agent/index.js";
   */
  generateDeepDive(bundle: { company: string; generatedAt: string; sections: { title: string; content: string }[]; verdict: string }): string {
    const lines: string[] = [];

    lines.push(`# ${bundle.company} — Deep Dive Report`);
    lines.push(``);
    lines.push(`*Generated ${bundle.generatedAt}*`);
    lines.push(`*Charon Intelligence · Powered by Selene · Zuse Holdings*`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // Table of contents
    lines.push(`## Contents`);
    bundle.sections.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title}`);
    });
    lines.push(`${bundle.sections.length + 1}. Strategic Verdict`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);

    // Sections
    for (const section of bundle.sections) {
      lines.push(`## ${section.title}`);
      lines.push(``);
      lines.push(section.content);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    // Strategic Verdict
    lines.push(`## Strategic Verdict`);
    lines.push(``);
    lines.push(bundle.verdict);
    lines.push(``);

    return lines.join("\n");
  }
