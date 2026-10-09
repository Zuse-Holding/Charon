import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "../components/marketing/MarketingShell";
import { BUSINESS_INTELLIGENCE_PATH, COMMITTEE_URL, DILIGENCE_URL } from "../lib/products";
import styles from "./hub.module.css";

// metisanalytic.com: the front door for the Metis products. Business
// Intelligence's own landing page moved to /business-intelligence; the app
// itself (/app, /dashboard, ...) didn't move.

const LINE = "One investigates a company from seven angles at once. One argues with a seller's numbers before you sign. One puts five AI analysts on a stock and grades every call they make.";

export const metadata: Metadata = {
  title: "Metis Intelligence",
  description: `Three tools from Metis. ${LINE}`,
  openGraph: {
    title: "Metis Intelligence",
    description: `Three tools from Metis. ${LINE}`,
    url: "https://metisanalytic.com",
    siteName: "Metis",
    type: "website",
  },
};

export default function Hub() {
  return (
    <MarketingShell subtitle="INTELLIGENCE">
      <section className={styles.hero}>
        <div className={styles.badge}>METIS INTELLIGENCE</div>
        <h1 className={styles.title}>Three tools from Metis.</h1>
        <p className={styles.sub}>{LINE}</p>
      </section>

      <section className={styles.products} aria-label="Products">
        <article className={styles.card}>
          <div className={styles.eyebrow}>Business Intelligence</div>
          <h2 className={styles.cardTitle}>Research a company, a person or a product</h2>
          <p className={styles.cardBody}>
            Seven agents work on it at the same time, covering the website, news, competitors, corporate filings,
            leadership and products. You get one report back.
          </p>
          <p className={styles.who}>For founders, operators and BD teams.</p>
          <div className={styles.actions}>
            <Link href={BUSINESS_INTELLIGENCE_PATH} className={styles.primary}>Explore Business Intelligence →</Link>
            <Link href="/login" className={styles.secondary}>Sign in</Link>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.eyebrow}>Diligence</div>
          <h2 className={styles.cardTitle}>Red-team a CIM before you sign the LOI</h2>
          <p className={styles.cardBody}>
            Upload the CIM, the P&amp;Ls and the tax returns. Four AI analysts check the seller&apos;s numbers against the
            documents and against each other, and every claim points to the page it came from.
          </p>
          <p className={styles.who}>For people buying a business worth $1M to $10M.</p>
          <div className={styles.actions}>
            <a href={DILIGENCE_URL} className={styles.primary}>Explore Diligence ↗</a>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.eyebrow}>Committee</div>
          <h2 className={styles.cardTitle}>You did the research. Now put it into action.</h2>
          <p className={styles.cardBody}>
            Each trading day, five AI analysts (value, growth, macro, risk and technical) debate a stock and a chairman
            makes the call. Every call is graded in public, and you can paper-trade alongside them.
          </p>
          <p className={styles.who}>For self-directed investors. Paper trading only, not investment advice.</p>
          <div className={styles.actions}>
            <a href={COMMITTEE_URL} className={styles.primary}>Explore Committee ↗</a>
          </div>
        </article>
      </section>
    </MarketingShell>
  );
}
