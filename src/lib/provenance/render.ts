import type { ProvenanceRecord } from "./build.js";

/**
 * The "Findings and Sources" report section. One line per finding:
 *
 *   - [single_source] Leadership | Jane Doe — CEO | [acme.com](https://acme.com/team) | 2026-10-05 | ai_extracted
 *
 * web/components/ReportViewer.tsx parses exactly this shape (FINDING_LINE
 * there); change both together. Markdown downloads and printouts carry the
 * same fields because they're plain report text.
 */
export const PROVENANCE_SECTION_TITLE = "Findings and Sources";

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
const linkText = (s: string) => cell(s).replace(/\[/g, "(").replace(/\]/g, ")");
const linkUrl = (s: string) => s.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

export function summaryLine(r: ProvenanceRecord): string {
  const n = r.findings.length;
  let line = `${n} finding${n === 1 ? "" : "s"}: ${r.counts.confirmed} confirmed by two or more sources, ` +
    `${r.counts.single_source} from a single source, ${r.counts.unverified} unverified. ` +
    `${r.snapshotCount} source response${r.snapshotCount === 1 ? "" : "s"} stored.`;
  if (r.untraceable > 0) line += ` ${r.untraceable} claim${r.untraceable === 1 ? "" : "s"} had no source link at all.`;
  return line;
}

export function pushProvenanceSection(lines: string[], r: ProvenanceRecord | undefined): void {
  if (!r) return;
  lines.push(`## ${PROVENANCE_SECTION_TITLE}`);
  lines.push(`_${summaryLine(r)}_`);
  for (const f of r.findings) {
    lines.push(
      `- [${f.verification}] ${cell(f.section)} | ${cell(f.claim)} | [${linkText(f.source_name)}](${linkUrl(f.source_url)}) | ` +
      `${f.retrieved_at.slice(0, 10)} | ${f.retrieval_method}`,
    );
  }
  lines.push(``);
}
