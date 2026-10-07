import type { CoverageEntry } from "./recorder.js";

/**
 * The "Source Coverage" report section. First line is the one-line
 * summary, then one line per source:
 *
 *   - [no_results] USAspending federal awards | US federal | government contracts | No matches for "Acme" | -
 *   - [not_searched] PACER federal court records | US federal | courts | Paid, registered accounts only. | [Search by hand](https://...)
 *
 * web/components/ReportViewer.tsx parses exactly this shape (COVERAGE_LINE
 * there); change both together.
 */
export const COVERAGE_SECTION_TITLE = "Source Coverage";

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
const linkUrl = (s: string) => s.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

export function coverageSummary(entries: CoverageEntry[]): string {
  const searched = entries.filter((e) => e.status === "results" || e.status === "no_results").length;
  const failed = entries.filter((e) => e.status === "error").length;
  const manual = entries.filter((e) => e.status === "not_searched").length;
  let line = `${searched} of ${entries.length} sources searched`;
  if (failed > 0) line += `; ${failed} failed`;
  if (manual > 0) line += `; ${manual} require${manual === 1 ? "s" : ""} manual check`;
  return `${line}.`;
}

function detail(e: CoverageEntry): string {
  switch (e.status) {
    case "results": return `${e.count} result${e.count === 1 ? "" : "s"}${e.section ? `, see ${e.section}` : ""}`;
    case "no_results": return `No matches for "${e.query}"`;
    case "not_searched": return e.reason ?? "Not searched";
    case "error": return `Error: ${e.reason ?? "the search failed"}`;
  }
}

export function pushCoverageSection(lines: string[], entries: CoverageEntry[] | undefined): void {
  if (!entries) return;
  lines.push(`## ${COVERAGE_SECTION_TITLE}`);
  lines.push(`_${coverageSummary(entries)}_`);
  for (const e of entries) {
    const link = e.url ? `[Search by hand](${linkUrl(e.url)})` : "-";
    lines.push(`- [${e.status}] ${cell(e.name)} | ${cell(e.jurisdiction)} | ${cell(e.category)} | ${cell(detail(e))} | ${link}`);
  }
  lines.push(``);
}
