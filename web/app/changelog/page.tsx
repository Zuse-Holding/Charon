import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import styles from "./changelog.module.css";

// Public changelog: what actually shipped, newest first. To post, add a
// "## <date>" section at the top of content/changelog.md every week or two.
// Shipped and live only: no roadmap items, nothing behind a feature flag
// that's off in production, nothing internal-only (political, creator, admin).
const CHANGELOG_FILE = path.join(process.cwd(), "content", "changelog.md");

export const metadata: Metadata = {
  title: "Changelog — Metis",
  description: "What shipped in Metis, newest first.",
  openGraph: {
    title: "Changelog — Metis",
    description: "What shipped in Metis, newest first.",
    url: "https://metisanalytic.com/changelog",
    type: "website",
  },
};

export default function ChangelogPage() {
  const markdown = fs.readFileSync(CHANGELOG_FILE, "utf-8");
  return (
    <MarketingShell>
      <div className={styles.header}>
        <h1 className={styles.title}>Changelog</h1>
        <p className={styles.desc}>What shipped, newest first. Posted every week or two.</p>
      </div>
      <div className={styles.body}>
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    </MarketingShell>
  );
}
