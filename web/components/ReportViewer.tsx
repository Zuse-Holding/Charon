"use client";
import { useState } from "react";
import { isEnabled } from "../lib/flags";
import styles from "./ReportViewer.module.css";

// Provenance (Feature 2): the "Findings and Sources" section that
// src/lib/provenance/render.ts writes, one finding per line:
//   - [single_source] Leadership | Jane Doe — CEO | [acme.com](https://acme.com/team) | 2026-10-05 | ai_extracted
// Change both files together.
const PROVENANCE_TITLE = "Findings and Sources";
const FINDING_LINE = /^\[(confirmed|single_source|unverified)\] (.+?) \| (.+?) \| \[(.+?)\]\((.+?)\) \| (\d{4}-\d{2}-\d{2}) \| (\w+)$/;

type Verification = "confirmed" | "single_source" | "unverified";
interface FindingRow {
  verification: Verification;
  section: string;
  claim: string;
  sourceName: string;
  sourceUrl: string;
  retrieved: string;
  method: string;
}

// Symbol + words, never colour alone.
const VERIFICATION_LABEL: Record<Verification, { label: string; symbol: string; className: string }> = {
  confirmed: { label: "Confirmed", symbol: "✓", className: "fConfirmed" },
  single_source: { label: "Single source", symbol: "●", className: "fSingle" },
  unverified: { label: "Unverified", symbol: "!", className: "fUnverified" },
};
const METHOD_LABEL: Record<string, string> = {
  api: "API", scrape: "Web page", manual_entry: "Manual entry", ai_extracted: "AI extracted",
};

function parseFindings(content: string[]): { summary: string; rows: FindingRow[] } {
  const summary = (content.find((l) => l.trim().startsWith("_")) ?? "").trim().replace(/^_|_$/g, "");
  const rows: FindingRow[] = [];
  for (const line of content) {
    const m = line.trim().replace(/^- /, "").match(FINDING_LINE);
    if (m) {
      rows.push({
        verification: m[1] as Verification, section: m[2], claim: m[3], sourceName: m[4], sourceUrl: m[5],
        retrieved: m[6], method: m[7],
      });
    }
  }
  return { summary, rows };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadFindingsCsv(rows: FindingRow[]) {
  const header = ["verification", "section", "finding", "source_name", "source_url", "retrieved_at", "retrieval_method"];
  const body = rows.map((r) => [r.verification, r.section, r.claim, r.sourceName, r.sourceUrl, r.retrieved, r.method].map(csvCell).join(","));
  const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "findings-and-sources.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Coverage ledger (Feature 1): the "Source Coverage" section that
// src/lib/coverage/render.ts writes, one source per line:
//   - [not_searched] PACER federal court records | US federal | courts | Paid accounts only. | [Search by hand](https://...)
// Change both files together.
const COVERAGE_TITLE = "Source Coverage";
const COVERAGE_LINE = /^\[(results|no_results|not_searched|error)\] (.+?) \| (.+?) \| (.+?) \| (.+?) \| (?:\[(.+?)\]\((.+?)\)|-)$/;

type CoverageStatus = "results" | "no_results" | "not_searched" | "error";
interface CoverageRow {
  status: CoverageStatus;
  name: string;
  jurisdiction: string;
  category: string;
  detail: string;
  url?: string;
}

const COVERAGE_LABEL: Record<CoverageStatus, { label: string; symbol: string; className: string }> = {
  results: { label: "Results", symbol: "✓", className: "fConfirmed" },
  no_results: { label: "No matches", symbol: "○", className: "fSingle" },
  not_searched: { label: "Not searched", symbol: "–", className: "fUnverified" },
  error: { label: "Error", symbol: "✕", className: "fError" },
};

function parseCoverage(content: string[]): { summary: string; rows: CoverageRow[] } {
  const summary = (content.find((l) => l.trim().startsWith("_")) ?? "").trim().replace(/^_|_$/g, "");
  const rows: CoverageRow[] = [];
  for (const line of content) {
    const m = line.trim().replace(/^- /, "").match(COVERAGE_LINE);
    if (m) {
      rows.push({ status: m[1] as CoverageStatus, name: m[2], jurisdiction: m[3], category: m[4], detail: m[5].replace(/^Error: /, ""), url: m[7] });
    }
  }
  return { summary, rows };
}

function CoverageSection({ content, onRetry }: { content: string[]; onRetry?: () => void }) {
  const { summary, rows } = parseCoverage(content);
  const hasErrors = rows.some((r) => r.status === "error");
  return (
    <div className={styles.provenance}>
      {summary && <p className={styles.provSummary}>{summary}</p>}
      {hasErrors && onRetry && (
        <button type="button" className={styles.provCsv} onClick={onRetry}>
          Run this report again
        </button>
      )}
      {rows.length > 0 && (
        <details className={styles.provDetails} open={hasErrors}>
          <summary>Show what was checked at each of the {rows.length} sources</summary>
          <table className={styles.provTable}>
            <thead>
              <tr><th>Status</th><th>Source</th><th>Jurisdiction</th><th>Type</th><th>Details</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const s = COVERAGE_LABEL[r.status];
                return (
                  <tr key={i}>
                    <td data-label="Status"><span className={`${styles.fBadge} ${styles[s.className]}`}>{s.symbol} {s.label}</span></td>
                    <td data-label="Source">{r.name}</td>
                    <td data-label="Jurisdiction">{r.jurisdiction}</td>
                    <td data-label="Type">{r.category}</td>
                    <td data-label="Details">
                      {r.detail}
                      {r.url && (
                        <> <a href={r.url} target="_blank" rel="noopener noreferrer">Search by hand ↗</a></>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

// Domain posture (Feature 5): the "Domain Posture" section that
// src/agents/domain-posture-agent/render.ts writes, one check per line:
//   - [flag:medium] DMARC | No DMARC record. | Spoofed email ... | [Public DNS (_dmarc TXT)](https://...)
// Change both files together.
const POSTURE_TITLE = "Domain Posture";
const POSTURE_LINE = /^\[(ok|info|unknown|flag:(?:high|medium|low))\] (.+?) \| (.+?) \| (.+?) \| \[(.+?)\]\((.+?)\)$/;

interface PostureRow {
  status: string;
  severity?: "high" | "medium" | "low";
  label: string;
  detail: string;
  impact?: string;
  sourceName: string;
  sourceUrl: string;
}

const SEVERITY_LABEL: Record<string, { label: string; className: string }> = {
  high: { label: "High", className: "fError" },
  medium: { label: "Medium", className: "fUnverified" },
  low: { label: "Low", className: "fSingle" },
};
const POSTURE_STATUS: Record<string, { label: string; symbol: string; className: string }> = {
  ok: { label: "OK", symbol: "✓", className: "fConfirmed" },
  info: { label: "Info", symbol: "i", className: "fSingle" },
  unknown: { label: "Unknown", symbol: "?", className: "fUnverified" },
};

function parsePosture(content: string[]): { summary: string; rows: PostureRow[] } {
  const summary = (content.find((l) => l.trim().startsWith("_")) ?? "").trim().replace(/^_|_$/g, "");
  const rows: PostureRow[] = [];
  for (const line of content) {
    const m = line.trim().replace(/^- /, "").match(POSTURE_LINE);
    if (!m) continue;
    const [status, severity] = m[1].split(":");
    rows.push({
      status, severity: severity as PostureRow["severity"], label: m[2], detail: m[3],
      impact: m[4] === "-" ? undefined : m[4], sourceName: m[5], sourceUrl: m[6],
    });
  }
  return { summary, rows };
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function PostureSection({ content }: { content: string[] }) {
  const { summary, rows } = parsePosture(content);
  const flags = rows.filter((r) => r.status === "flag")
    .sort((a, b) => SEVERITY_ORDER[a.severity ?? "medium"] - SEVERITY_ORDER[b.severity ?? "medium"]);
  const rest = rows.filter((r) => r.status !== "flag");
  return (
    <div className={styles.provenance}>
      {summary && <p className={styles.provSummary}>{summary}</p>}
      {flags.map((r, i) => {
        const s = SEVERITY_LABEL[r.severity ?? "medium"];
        return (
          <div key={i} className={styles.postureFlag}>
            <div className={styles.postureHead}>
              <span className={`${styles.fBadge} ${styles[s.className]}`}>! {s.label}</span>
              <span className={styles.postureLabel}>{r.label}</span>
            </div>
            <div className={styles.postureDetail}>{r.detail}</div>
            {r.impact && <div className={styles.postureImpact}><strong>Why it matters:</strong> {r.impact}</div>}
            <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.postureSource}>{r.sourceName} ↗</a>
          </div>
        );
      })}
      {rest.length > 0 && (
        <div className={styles.postureList}>
          {rest.map((r, i) => {
            const s = POSTURE_STATUS[r.status] ?? POSTURE_STATUS.unknown;
            return (
              <div key={i} className={styles.postureRow}>
                <span className={`${styles.fBadge} ${styles[s.className]}`}>{s.symbol} {s.label}</span>
                <span className={styles.postureLabel}>{r.label}</span>
                <span className={styles.postureDetail}>
                  {r.detail}{" "}
                  <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.postureSource}>{r.sourceName} ↗</a>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Related entities (Feature 4): the "Related Entities" section that
// src/agents/related-entities-agent/render.ts writes:
//   - node n0 | company | ACME LLC | NY 123 | 0 | https://...
//   - edge n0 > n1 | chairman or CEO | hard | single_source | [New York Department of State filing](https://...) | 2026-10-07
// Change both files together.
const RELATED_TITLE = "Related Entities";
const NODE_LINE = /^node (n\d+) \| (company|person|agent|address) \| (.+?) \| (.+?) \| (\d) \| (.+)$/;
const EDGE_LINE = /^edge (n\d+) > (n\d+) \| (.+?) \| (hard|weak) \| (confirmed|single_source|unverified) \| \[(.+?)\]\((.+?)\) \| (\d{4}-\d{2}-\d{2})$/;

type NodeKind = "company" | "person" | "agent" | "address";
interface RelNode { id: string; kind: NodeKind; label: string; identifier?: string; hop: number; url?: string }
interface RelEdge { from: string; to: string; relation: string; strength: "hard" | "weak"; verification: string; sourceName: string; sourceUrl: string; retrieved: string }

const NODE_STYLE: Record<NodeKind, { color: string; label: string }> = {
  company: { color: "var(--orange)", label: "Company" },
  person: { color: "var(--cyan)", label: "Person" },
  agent: { color: "var(--yellow)", label: "Registered agent" },
  address: { color: "var(--green)", label: "Address" },
};

function parseRelated(content: string[]): { summary: string; nodes: RelNode[]; edges: RelEdge[] } {
  const summary = (content.find((l) => l.trim().startsWith("_")) ?? "").trim().replace(/^_|_$/g, "");
  const nodes: RelNode[] = [];
  const edges: RelEdge[] = [];
  for (const line of content) {
    const l = line.trim().replace(/^- /, "");
    const n = l.match(NODE_LINE);
    if (n) {
      nodes.push({ id: n[1], kind: n[2] as NodeKind, label: n[3], identifier: n[4] === "-" ? undefined : n[4], hop: Number(n[5]), url: n[6] === "-" ? undefined : n[6] });
      continue;
    }
    const e = l.match(EDGE_LINE);
    if (e) edges.push({ from: e[1], to: e[2], relation: e[3], strength: e[4] as "hard" | "weak", verification: e[5], sourceName: e[6], sourceUrl: e[7], retrieved: e[8] });
  }
  return { summary, nodes, edges };
}

/** Rings by hop: the target in the middle, each node near its parent. */
function layout(nodes: RelNode[], edges: RelEdge[], w: number, h: number): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number; a: number }>();
  const cx = w / 2, cy = h / 2;
  const roots = nodes.filter((n) => n.hop === 0);
  roots.forEach((n, i) => pos.set(n.id, { x: cx + (i - (roots.length - 1) / 2) * 90, y: cy, a: 0 }));
  const maxHop = Math.max(0, ...nodes.map((n) => n.hop));
  const ringGap = Math.min(w, h) / 2 / (maxHop + 0.6);
  for (let hop = 1; hop <= maxHop; hop++) {
    const ring = nodes.filter((n) => n.hop === hop);
    const parentAngle = (n: RelNode) => {
      const e = edges.find((x) => x.to === n.id && pos.has(x.from)) ?? edges.find((x) => x.from === n.id && pos.has(x.to));
      const p = e ? pos.get(e.to === n.id ? e.from : e.to) : undefined;
      return p ? p.a : 0;
    };
    const sorted = [...ring].sort((a, b) => parentAngle(a) - parentAngle(b));
    sorted.forEach((n, i) => {
      const a = hop === 1 ? (2 * Math.PI * i) / Math.max(1, sorted.length) - Math.PI / 2
        : parentAngle(n) + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.05);
      const r = ringGap * hop;
      pos.set(n.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), a });
    });
    if (hop > 1) {
      // spread this ring evenly, keeping parent order
      sorted.forEach((n, i) => {
        const a = (2 * Math.PI * i) / Math.max(1, sorted.length) - Math.PI / 2;
        const keep = pos.get(n.id)!;
        const blended = sorted.length > 6 ? a : keep.a;
        const r = ringGap * hop;
        pos.set(n.id, { x: cx + r * Math.cos(blended), y: cy + r * Math.sin(blended), a: blended });
      });
    }
  }
  return pos;
}

function Shape({ kind, x, y, r }: { kind: NodeKind; x: number; y: number; r: number }) {
  const fill = NODE_STYLE[kind].color;
  if (kind === "company") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2} fill={fill} />;
  if (kind === "agent") return <polygon points={`${x},${y - r * 1.2} ${x + r * 1.2},${y} ${x},${y + r * 1.2} ${x - r * 1.2},${y}`} fill={fill} />;
  if (kind === "address") return <polygon points={`${x},${y - r * 1.2} ${x + r * 1.1},${y + r * 0.9} ${x - r * 1.1},${y + r * 0.9}`} fill={fill} />;
  return <circle cx={x} cy={y} r={r} fill={fill} />;
}

function downloadRelatedCsv(nodes: RelNode[], edges: RelEdge[]) {
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const header = ["from", "relation", "to", "to_identifier", "link_strength", "verification", "source_name", "source_url", "retrieved_at"];
  const body = edges.map((e) => [label(e.from), e.relation, label(e.to), nodes.find((n) => n.id === e.to)?.identifier ?? "",
    e.strength, e.verification, e.sourceName, e.sourceUrl, e.retrieved].map(csvCell).join(","));
  const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "related-entities.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function RelatedSection({ content }: { content: string[] }) {
  const { summary, nodes, edges } = parseRelated(content);
  const [view, setView] = useState<"graph" | "table">("graph");
  const W = 640, H = 440;
  const pos = layout(nodes, edges, W, H);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const short = (s: string) => (s.length > 24 ? `${s.slice(0, 23)}…` : s);
  return (
    <div className={styles.provenance}>
      {summary && <p className={styles.provSummary}>{summary}</p>}
      <div className={styles.relBar}>
        <div className={styles.relTabs} role="tablist">
          <button type="button" role="tab" aria-selected={view === "graph"} className={view === "graph" ? styles.relTabOn : styles.relTab} onClick={() => setView("graph")}>Graph</button>
          <button type="button" role="tab" aria-selected={view === "table"} className={view === "table" ? styles.relTabOn : styles.relTab} onClick={() => setView("table")}>Table</button>
        </div>
        <button type="button" className={styles.provCsv} onClick={() => downloadRelatedCsv(nodes, edges)}>Download links (CSV)</button>
      </div>
      {view === "graph" ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className={styles.relGraph} role="img" aria-label={`Related entities graph: ${nodes.length} nodes, ${edges.length} links`}>
            {edges.map((e, i) => {
              const a = pos.get(e.from), b = pos.get(e.to);
              if (!a || !b) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth={e.strength === "hard" ? 1.6 : 1}
                strokeDasharray={e.strength === "weak" ? "5 4" : undefined}><title>{`${byId.get(e.from)?.label} — ${e.relation} — ${byId.get(e.to)?.label} (${e.strength === "hard" ? "stated in the filing" : "name or address match"})`}</title></line>;
            })}
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              return (
                <g key={n.id}>
                  <Shape kind={n.kind} x={p.x} y={p.y} r={n.hop === 0 ? 9 : 6} />
                  <text x={p.x} y={p.y + (n.hop === 0 ? 22 : 17)} textAnchor="middle" className={styles.relLabel}>{short(n.label)}</text>
                  <title>{`${NODE_STYLE[n.kind].label}: ${n.label}${n.identifier ? ` (${n.identifier})` : ""}`}</title>
                </g>
              );
            })}
          </svg>
          <div className={styles.relLegend}>
            {(Object.keys(NODE_STYLE) as NodeKind[]).map((k) => (
              <span key={k} className={styles.relLegendItem}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><Shape kind={k} x={7} y={7} r={5} /></svg>
                {NODE_STYLE[k].label}
              </span>
            ))}
            <span className={styles.relLegendItem}>── stated in the filing</span>
            <span className={styles.relLegendItem}>- - - name or address match, not followed</span>
          </div>
        </>
      ) : (
        <table className={styles.provTable}>
          <thead>
            <tr><th>From</th><th>Link</th><th>To</th><th>Strength</th><th>Source</th><th>Retrieved</th></tr>
          </thead>
          <tbody>
            {edges.map((e, i) => {
              const to = byId.get(e.to);
              return (
                <tr key={i}>
                  <td data-label="From">{byId.get(e.from)?.label}</td>
                  <td data-label="Link">{e.relation}</td>
                  <td data-label="To">{to?.label}{to?.identifier ? <span className={styles.provMono}> · {to.identifier}</span> : null}</td>
                  <td data-label="Strength">
                    <span className={`${styles.fBadge} ${e.strength === "hard" ? styles.fSingle : styles.fUnverified}`}>
                      {e.strength === "hard" ? "● In the filing" : "! Name/address match"}
                    </span>
                  </td>
                  <td data-label="Source"><a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceName} ↗</a></td>
                  <td data-label="Retrieved" className={styles.provMono}>{e.retrieved}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProvenanceSection({ content }: { content: string[] }) {
  const { summary, rows } = parseFindings(content);
  return (
    <div className={styles.provenance}>
      {summary && <p className={styles.provSummary}>{summary}</p>}
      {rows.length > 0 && (
        <>
          <button type="button" className={styles.provCsv} onClick={() => downloadFindingsCsv(rows)}>
            Download findings (CSV)
          </button>
          <details className={styles.provDetails}>
            <summary>Show all {rows.length} findings with their sources</summary>
            <table className={styles.provTable}>
              <thead>
                <tr><th>Status</th><th>Section</th><th>Finding</th><th>Source</th><th>Retrieved</th><th>Method</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const v = VERIFICATION_LABEL[r.verification];
                  return (
                    <tr key={i}>
                      <td data-label="Status"><span className={`${styles.fBadge} ${styles[v.className]}`}>{v.symbol} {v.label}</span></td>
                      <td data-label="Section">{r.section}</td>
                      <td data-label="Finding">{r.claim}</td>
                      <td data-label="Source"><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{r.sourceName} ↗</a></td>
                      <td data-label="Retrieved" className={styles.provMono}>{r.retrieved}</td>
                      <td data-label="Method">{METHOD_LABEL[r.method] ?? r.method}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

interface ReportViewerProps {
  markdown: string;
  /** Re-runs the whole report. Offered when a source failed. */
  onRetry?: () => void;
}

interface Section {
  title: string;
  content: string[];
}

function parseMarkdown(md: string): Section[] {
  const lines = md.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { title: line.replace("## ", "").trim(), content: [] };
    } else if (line.startsWith("# ")) {
      // Skip the h1 title — displayed in header
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseListItems(lines: string[]): string[] {
  return lines
    .filter(l => l.trim().startsWith("- "))
    .map(l => l.replace(/^[\s]*- /, "").trim());
}

function parseLinkItems(lines: string[]): { text: string; url: string; sub?: string }[] {
  return lines
    .filter(l => l.trim().startsWith("- "))
    .map(l => {
      const raw = l.replace(/^[\s]*- /, "").trim();
      const match = raw.match(/^\[(.+?)\]\((.+?)\)(?:\s*—\s*(.+))?/);
      if (match) return { text: match[1], url: match[2], sub: match[3] };
      return { text: raw, url: "#" };
    });
}

function parseKeyValue(lines: string[]): { key: string; value: string }[] {
  return lines
    .filter(l => l.trim().startsWith("- **"))
    .map(l => {
      const match = l.match(/\*\*(.+?)\*\*[:\s]+(.+)/);
      if (match) return { key: match[1], value: match[2].trim() };
      return { key: "", value: l };
    })
    .filter(kv => kv.key);
}

// Task 3.3 — report-agent now appends a "**Sources:**" numbered-link
// block (or an "_Unverified..._" line when a section has none) right
// after every section's own content, instead of one combined "## Sources"
// heading at the end of the report. Split that sub-block off before
// handing the rest to renderSection's per-title logic below, so it
// doesn't get mangled by e.g. getPlainText() stripping/flattening it —
// the numbered-link renderer already used for the old flat Sources
// section is reused for this per-section version.
function splitOutSources(content: string[]): { body: string[]; sourceLines: string[] | null; unverified: boolean } {
  const markerIdx = content.findIndex(
    (l) => l.trim() === "**Sources:**" || l.trim().startsWith("_Unverified")
  );
  if (markerIdx === -1) return { body: content, sourceLines: null, unverified: false };

  const marker = content[markerIdx].trim();
  if (marker.startsWith("_Unverified")) {
    return { body: content.slice(0, markerIdx), sourceLines: null, unverified: true };
  }
  return { body: content.slice(0, markerIdx), sourceLines: content.slice(markerIdx + 1), unverified: false };
}

function renderSectionSources(sourceLines: string[] | null, unverified: boolean) {
  if (unverified) {
    return <div className={styles.unverifiedBadge}>Unverified — no source recorded for this section</div>;
  }
  if (!sourceLines) return null;

  const links = sourceLines
    .filter((l) => /^\d+\./.test(l.trim()))
    .map((l) => {
      const match = l.match(/\[(.+?)\]\((.+?)\)/);
      return match ? { text: match[1], url: match[2] } : null;
    })
    .filter(Boolean) as { text: string; url: string }[];
  if (links.length === 0) return null;

  return (
    <div className={styles.sourcesList}>
      {links.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className={styles.sourceItem}>
          <span className={styles.sourceNum}>{i + 1}</span>
          <span className={styles.sourceText}>{s.text}</span>
          <span className={styles.sourceArrow}>↗</span>
        </a>
      ))}
    </div>
  );
}

function isPlaceholder(content: string[]): boolean {
  const text = content.join(" ").trim();
  return text.startsWith("_") && text.endsWith("_");
}

function getPlainText(content: string[]): string {
  return content
    .filter(l => l.trim() && !l.startsWith("#"))
    .join(" ")
    .replace(/\*\*/g, "")
    .trim();
}

function renderSection(section: Section, onRetry?: () => void) {
  const { title, content } = section;

  if (title === PROVENANCE_TITLE) return <ProvenanceSection content={content} />;
  if (title === COVERAGE_TITLE) return <CoverageSection content={content} onRetry={onRetry} />;
  if (title === POSTURE_TITLE) return <PostureSection content={content} />;
  if (title === RELATED_TITLE) return <RelatedSection content={content} />;

  if (isPlaceholder(content)) {
    return (
      <div className={styles.placeholder}>
        {getPlainText(content).replace(/^_|_$/g, "")}
      </div>
    );
  }

  // Executive Summary / Overview / Bio
  if (title === "Executive Summary" || title === "Overview") {
    return <p className={styles.summaryText}>{getPlainText(content)}</p>;
  }

  // Company / Product Overview — key-value grid
  if (title === "Company Overview" || title === "Product Details" || title === "Current Role") {
    const kvs = parseKeyValue(content);
    if (kvs.length > 0) {
      return (
        <div className={styles.kvGrid}>
          {kvs.map((kv, i) => (
            <div key={i} className={styles.kvCard}>
              <div className={styles.kvLabel}>{kv.key}</div>
              <div className={styles.kvValue}>{kv.value}</div>
            </div>
          ))}
        </div>
      );
    }
  }

  // Leadership / Career History — person cards
  if (title === "Leadership" || title === "Career History") {
    const items = parseListItems(content);
    if (items.length === 0) return <div className={styles.placeholder}>No data collected in this pass.</div>;
    return (
      <div className={styles.personList}>
        {items.map((item, i) => {
          // Split only on an em/en dash with space on both sides (the
          // literal " — " report-agent inserts between name and title).
          // A bare hyphen char-class here used to also match hyphens
          // inside names/titles themselves (e.g. "Evinyan-Iknoian",
          // "Co-Founder"), splitting mid-word and leaving a stray "**"
          // and the real separator stuck onto the title half.
          const match = item.match(/^(.+?)\s+[—–]\s+(.+)/);
          const clean = (s: string) => s.replace(/\*\*/g, "").trim();
          const name  = match ? clean(match[1]) : clean(item);
          const role  = match ? clean(match[2]) : "";
          const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={i} className={styles.personCard}>
              <div className={styles.avatar}>{initials}</div>
              <div>
                <div className={styles.personName}>{name}</div>
                {role && <div className={styles.personRole}>{role}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Competitors — chips
  if (title === "Competitors" || title === "Competing Products") {
    const items = parseListItems(content);
    if (items.length === 0) return <div className={styles.placeholder}>No competitors identified.</div>;
    return (
      <div className={styles.chips}>
        {items.map((item, i) => {
          const name = item.replace(/\*\*(.*?)\*\*/g, "$1").split(/[—\(]/)[0].trim();
          return <div key={i} className={styles.chip}>{name}</div>;
        })}
      </div>
    );
  }

  // Risks
  if (title === "Risks") {
    const items = parseListItems(content);
    if (items.length === 0) return <div className={styles.placeholder}>Requires LLM synthesis.</div>;
    return (
      <div className={styles.roList}>
        {items.map((item, i) => (
          <div key={i} className={`${styles.roItem} ${styles.risk}`}>
            <span className={styles.roBullet}>▸</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    );
  }

  // Opportunities
  if (title === "Opportunities") {
    const items = parseListItems(content);
    if (items.length === 0) return <div className={styles.placeholder}>Requires LLM synthesis.</div>;
    return (
      <div className={styles.roList}>
        {items.map((item, i) => (
          <div key={i} className={`${styles.roItem} ${styles.opp}`}>
            <span className={styles.roBullet}>▸</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    );
  }

  // Recent News
  if (title === "Recent News") {
    const links = parseLinkItems(content);
    if (links.length === 0) return <div className={styles.placeholder}>No recent news found.</div>;
    return (
      <div className={styles.newsList}>
        {links.map((n, i) => (
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" className={styles.newsCard}>
            <div className={styles.newsHeadline}>{n.text}</div>
            {n.sub && <div className={styles.newsSub}>{n.sub}</div>}
          </a>
        ))}
      </div>
    );
  }

  // Products / Specs — generic list
  if (title === "Products" || title === "Specs") {
    const items = parseListItems(content);
    if (items.length === 0) return <div className={styles.placeholder}>No data collected.</div>;
    return (
      <div className={styles.productList}>
        {items.map((item, i) => {
          const clean = item.replace(/\*\*(.*?)\*\*/g, "$1");
          return (
            <div key={i} className={styles.productRow}>
              <span className={styles.productDot} />
              <span>{clean}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Funding
  if (title === "Funding") {
    const items = parseListItems(content);
    if (items.length === 0) return <div className={styles.placeholder}>No funding data collected.</div>;
    return (
      <div className={styles.fundingList}>
        {items.map((item, i) => (
          <div key={i} className={styles.fundingRow}>
            <span className={styles.fundingDot} />
            <span className={styles.fundingText}>{item.replace(/\*\*(.*?)\*\*/g, "$1")}</span>
          </div>
        ))}
      </div>
    );
  }

  // Default — render as plain text / list
  const items = parseListItems(content);
  if (items.length > 0) {
    return (
      <div className={styles.genericList}>
        {items.map((item, i) => (
          <div key={i} className={styles.genericItem}>
            {item.replace(/\*\*(.*?)\*\*/g, "$1")}
          </div>
        ))}
      </div>
    );
  }
  return <p className={styles.summaryText}>{getPlainText(content)}</p>;
}

export default function ReportViewer({ markdown, onRetry }: ReportViewerProps) {
  const sections = parseMarkdown(markdown);
  // Reports from before per-finding provenance carry no Findings section:
  // say so plainly rather than let them read as checked.
  const legacy = isEnabled("provenance") && sections.length > 0 && !sections.some((s) => s.title === PROVENANCE_TITLE);

  return (
    <div className={styles.viewer}>
      {legacy && (
        <div className={styles.legacyBanner} role="note">
          ! This report was created before Metis recorded a source for every finding. Treat its contents as unverified.
        </div>
      )}
      {sections.map((section, i) => {
        const { body, sourceLines, unverified } = splitOutSources(section.content);
        return (
          <div key={i} className={styles.section}>
            <div className={styles.sectionLabel}>{section.title}</div>
            {renderSection({ title: section.title, content: body }, onRetry)}
            {renderSectionSources(sourceLines, unverified)}
          </div>
        );
      })}
    </div>
  );
}
