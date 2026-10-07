import type { RelatedGraph } from "../../lib/expansion/engine.js";

/**
 * The "Related Entities" report section. A summary line, then nodes and
 * edges:
 *
 *   - node n0 | company | ACME LLC | NY 123 | 0 | https://...
 *   - edge n0 > n1 | chairman or CEO | hard | single_source | [New York Department of State filing](https://...) | 2026-10-07
 *
 * web/components/ReportViewer.tsx parses exactly this shape (NODE_LINE and
 * EDGE_LINE there); change both together.
 */
export const RELATED_SECTION_TITLE = "Related Entities";

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").replace(/>/g, "›").trim();
const linkText = (s: string) => cell(s).replace(/\[/g, "(").replace(/\]/g, ")");
const linkUrl = (s: string) => s.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

export function relatedSummary(g: RelatedGraph): string {
  const companies = g.nodes.filter((n) => n.kind === "company" && n.hop > 0).length;
  const weak = g.edges.filter((e) => e.strength === "weak").length;
  const parts = [
    `${companies} related compan${companies === 1 ? "y" : "ies"} within ${g.hops} hop${g.hops === 1 ? "" : "s"}`,
    `${weak} link${weak === 1 ? "" : "s"} found by name or address only (shown, not followed)`,
  ];
  if (g.excluded.length) parts.push(`${g.excluded.length} mass registered agent${g.excluded.length === 1 ? "" : "s"} or address${g.excluded.length === 1 ? "" : "es"} left out`);
  if (g.common.length) parts.push(`${g.common.length} officer name${g.common.length === 1 ? "" : "s"} too common to link`);
  if (g.truncated) parts.push("graph cut off at its size limit");
  return `${parts.join("; ")}. Source: public state filings.`;
}

export function pushRelatedSection(lines: string[], g: RelatedGraph | undefined): void {
  if (!g || g.nodes.length === 0) return;
  const short = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  lines.push(`## ${RELATED_SECTION_TITLE}`);
  lines.push(`_${relatedSummary(g)}_`);
  for (const n of g.nodes) {
    lines.push(`- node ${short.get(n.id)} | ${n.kind} | ${cell(n.label)} | ${n.identifier ? cell(n.identifier) : "-"} | ${n.hop} | ${n.url ? linkUrl(n.url) : "-"}`);
  }
  for (const e of g.edges) {
    lines.push(`- edge ${short.get(e.from)} > ${short.get(e.to)} | ${cell(e.relation)} | ${e.strength} | ${e.verification} | ` +
      `[${linkText(e.sourceName)}](${linkUrl(e.sourceUrl)}) | ${e.retrievedAt.slice(0, 10)}`);
  }
  lines.push(``);
}
