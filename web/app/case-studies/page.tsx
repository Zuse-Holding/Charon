import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../../components/marketing/MarketingShell";
import shellStyles from "../../components/marketing/MarketingShell.module.css";
import styles from "./case-studies.module.css";

export const metadata: Metadata = {
  title: "Case Studies — Metis",
  description:
    "Real results from teams using Metis for diligence and research. Case studies coming soon.",
  openGraph: {
    title: "Case Studies — Metis",
    description: "Real results from teams using Metis for diligence and research. Coming soon.",
    url: "https://metisanalytic.com/case-studies",
    type: "website",
  },
};

const SLOTS = [
  { tag: "DEAL TEAM", title: "Faster diligence cycles", body: "How a deal team cut early-stage screening time using Deep Dive reports." },
  { tag: "SOLO ANALYST", title: "One person, full coverage", body: "How an independent analyst covers a wider watchlist without adding headcount." },
  { tag: "CORP DEV", title: "Competitive tracking at scale", body: "How a corp dev team uses the Knowledge Graph to track a moving competitive set." },
];

export default function CaseStudiesPage() {
  return (
    <MarketingShell>
      <section className={styles.hero}>
        <div className={styles.badge}>
          <span>◈</span>
          RESULTS COMING SOON
        </div>
        <h1 className={styles.title}>Case studies are on the way.</h1>
        <p className={styles.sub}>
          We're working with early customers to put real numbers behind what Metis saves them.
          This page will fill in as those stories clear review — for now, here's what's coming.
        </p>
      </section>

      <section className={styles.grid}>
        {SLOTS.map((slot) => (
          <div key={slot.title} className={styles.card}>
            <span className={styles.cardTag}>{slot.tag} · COMING SOON</span>
            <div className={styles.cardTitle}>{slot.title}</div>
            <div className={styles.cardBody}>{slot.body}</div>
            <div className={styles.cardShape} />
          </div>
        ))}
      </section>

      <div className={styles.notice}>
        <div className={styles.noticeBox}>
          <strong>Want an early look?</strong> Reach out at{" "}
          <a href="mailto:support@metisanalytic.com" className={shellStyles.footerLink}>support@metisanalytic.com</a>{" "}
          and we'll share what we can ahead of publishing.
        </div>
      </div>

      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>Don't want to wait for the case study?</h2>
        <p className={styles.finalCtaSub}>See what Metis finds on a company you already know.</p>
        <Link href="/login?mode=signup" className={shellStyles.btnHeroPrimary}>
          Start Free →
        </Link>
      </section>
    </MarketingShell>
  );
}
