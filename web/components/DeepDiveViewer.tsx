"use client";
import styles from "./DeepDiveViewer.module.css";

interface Section {
  title: string;
  content: string;
  riskLevel?: "high" | "medium" | "low";
}

interface Props {
  company: string;
  generatedAt: string;
  durationMs: number;
  sections: Section[];
}

const RISK_COLORS: Record<string, string> = {
  high: "var(--red)",
  medium: "var(--orange)",
  low: "var(--green)",
};

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Simple inline markdown renderer for prose content
function renderContent(content: string) {
  const lines = content.split("\n").filter(l => l.trim());
  return lines.map((line, i) => {
    // Bold text
    const withBold = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    return (
      <p
        key={i}
        className={styles.prose}
        dangerouslySetInnerHTML={{ __html: withBold }}
      />
    );
  });
}

const SECTION_ICONS: Record<string, string> = {
  "Executive Brief": "◈",
  "Founding & History": "⊙",
  "Leadership Deep Dive": "◎",
  "Funding & Financials": "⊞",
  "Products & Traction": "⬡",
  "Risk Flags": "⚠",
  "Competitive Context": "⊕",
  "Market Sizing": "◉",
  "Strategic Options": "⊗",
  "Verdict": "◆",
};

export default function DeepDiveViewer({ company, generatedAt, durationMs, sections }: Props) {
  return (
    <div className={styles.viewer} id="deep-dive-print">
      <div className={styles.reportMeta}>
        <div className={styles.metaLabel}>DEEP DIVE ANALYSIS · {company.toUpperCase()}</div>
        <div className={styles.metaRight}>
          <span>{new Date(generatedAt).toLocaleString()}</span>
          <span className={styles.metaDot}>·</span>
          <span>{sections.length} sections</span>
          <span className={styles.metaDot}>·</span>
          <span>{formatDuration(durationMs)} analysis time</span>
        </div>
      </div>

      {sections.map((section, i) => (
        <div key={i} className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>
              {SECTION_ICONS[section.title] ?? "◈"}
            </span>
            <div>
              <div className={styles.sectionNum}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className={styles.sectionTitle}>{section.title}</div>
            </div>
            {section.riskLevel && (
              <div
                className={styles.riskBadge}
                style={{ color: RISK_COLORS[section.riskLevel], borderColor: RISK_COLORS[section.riskLevel] }}
              >
                {section.riskLevel.toUpperCase()} RISK
              </div>
            )}
          </div>

          <div className={styles.sectionBody}>
            {section.content.startsWith("_")
              ? <p className={styles.placeholder}>{section.content.replace(/^_|_$/g, "")}</p>
              : renderContent(section.content)
            }
          </div>

          {i < sections.length - 1 && <div className={styles.divider} />}
        </div>
      ))}
    </div>
  );
}
