"use client";
import styles from "./ReportViewer.module.css";

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
          const match = item.match(/^(.+?)\s*[—\-–]\s*(.+)/);
          const name  = match ? match[1].replace(/\*\*/g, "").trim() : item;
          const role  = match ? match[2].trim() : "";
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

  // Sources
  if (title === "Sources") {
    const links = content
      .filter(l => /^\d+\./.test(l.trim()))
      .map(l => {
        const match = l.match(/\[(.+?)\]\((.+?)\)/);
        return match ? { text: match[1], url: match[2] } : null;
      })
      .filter(Boolean) as { text: string; url: string }[];
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

  return (
    <div className={styles.viewer}>
      {sections.map((section, i) => (
        <div key={i} className={styles.section}>
          <div className={styles.sectionLabel}>{section.title}</div>
          {renderSection(section)}
        </div>
      ))}
    </div>
  );
}
