"use client";
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

function renderSection(section: Section) {
  const { title, content } = section;

  if (title === PROVENANCE_TITLE) return <ProvenanceSection content={content} />;

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

export default function ReportViewer({ markdown }: ReportViewerProps) {
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
            {renderSection({ title: section.title, content: body })}
            {renderSectionSources(sourceLines, unverified)}
          </div>
        );
      })}
    </div>
  );
}
