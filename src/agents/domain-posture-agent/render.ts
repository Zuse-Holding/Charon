import type { DomainPosture } from "./index.js";

/**
 * The "Domain Posture" report section. A summary line, then one line per
 * check:
 *
 *   - [flag:medium] DMARC | No DMARC record. | Spoofed email ... | [Public DNS (_dmarc TXT)](https://...)
 *   - [ok] Transfer lock | Transfer lock is on. | - | [RDAP registration record](https://...)
 *
 * web/components/ReportViewer.tsx parses exactly this shape (POSTURE_LINE
 * there); change both together.
 */
export const POSTURE_SECTION_TITLE = "Domain Posture";

const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
const linkText = (s: string) => cell(s).replace(/\[/g, "(").replace(/\]/g, ")");
const linkUrl = (s: string) => s.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

export function postureSummary(p: DomainPosture): string {
  const flags = p.checks.filter((c) => c.status === "flag");
  const bySeverity = (["high", "medium", "low"] as const)
    .map((s) => [s, flags.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  const head = flags.length === 0 ? "no flags" : `${flags.length} flag${flags.length === 1 ? "" : "s"} (${bySeverity.join(", ")})`;
  return `${p.domain}: ${head}. Public records only: registration (RDAP), public DNS and the site's certificate.`;
}

export function pushPostureSection(lines: string[], p: DomainPosture | undefined): void {
  if (!p) return;
  lines.push(`## ${POSTURE_SECTION_TITLE}`);
  lines.push(`_${postureSummary(p)}_`);
  for (const c of p.checks) {
    const tag = c.status === "flag" ? `flag:${c.severity ?? "medium"}` : c.status;
    lines.push(`- [${tag}] ${cell(c.label)} | ${cell(c.detail)} | ${c.impact ? cell(c.impact) : "-"} | [${linkText(c.sourceName)}](${linkUrl(c.sourceUrl)})`);
  }
  lines.push(``);
}
