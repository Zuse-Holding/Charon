import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import ReportViewer from "../../components/ReportViewer";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import shellStyles from "../../components/marketing/MarketingShell.module.css";
import styles from "./sample-report.module.css";

// One real company report, published in full and exactly as Metis wrote it.
// Sections Metis couldn't source are left out of every report. Regenerate with
// `npm run research -- Stripe` from the repo root, then copy
// reports/stripe.md here; don't hand-edit it.
const REPORT_FILE = path.join(process.cwd(), "content", "sample-reports", "stripe.md");

export const metadata: Metadata = {
  title: "Sample report: Stripe — Metis Intelligence",
  description:
    "A full Metis Intelligence company report on Stripe, shown exactly as generated: every section with the sources it came from.",
  openGraph: {
    title: "Sample report: Stripe — Metis Intelligence",
    description: "A full Metis Intelligence report, shown exactly as generated, every section with its sources.",
    url: "https://metisanalytic.com/sample-report",
    type: "article",
  },
};

function generatedDate(markdown: string): { iso: string; label: string } | null {
  const iso = markdown.match(/\*Generated (\d{4}-\d{2}-\d{2}T[^*]+)\*/)?.[1];
  if (!iso) return null;
  const label = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { iso, label };
}

export default function SampleReportPage() {
  const markdown = fs.readFileSync(REPORT_FILE, "utf-8");
  const generated = generatedDate(markdown);

  return (
    <MarketingShell>
      <section className={styles.hero}>
        <div className={styles.badge}>SAMPLE REPORT</div>
        <h1 className={styles.title}>Stripe, as Metis reports it</h1>
        <p className={styles.sub}>
          A full company report, published exactly as Metis wrote it. Every section lists the sources
          it came from. If Metis can&apos;t source a section, the section isn&apos;t in the report.
        </p>
        {generated && (
          <p className={styles.meta}>
            Generated <time dateTime={generated.iso}>{generated.label}</time> · Not edited after generation
          </p>
        )}
      </section>

      <section className={styles.report}>
        <ReportViewer markdown={markdown} />
      </section>

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Run one on a company you know.</h2>
        <p className={styles.ctaSub}>The fastest way to judge a report is on a subject you can check yourself.</p>
        <div className={styles.ctaRow}>
          <Link href="/login?mode=signup" className={shellStyles.btnHeroPrimary}>Create account →</Link>
          <Link href="/pricing" className={styles.ctaSecondary}>See pricing</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
