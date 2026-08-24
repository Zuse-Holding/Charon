import Link from "next/link";
import { MarketingShell } from "./MarketingShell";
import shellStyles from "./MarketingShell.module.css";
import styles from "./ComparisonPage.module.css";

export type ComparisonRow = {
  label: string;
  metis: string;
  competitor: string;
};

export type NarrativeCard = {
  title: string;
  body: string;
};

export function ComparisonPage({
  competitorName,
  badge,
  title,
  titleAccent,
  sub,
  rows,
  narrative,
  finalCtaTitle,
  finalCtaSub,
}: {
  competitorName: string;
  badge: string;
  title: string;
  titleAccent: string;
  sub: string;
  rows: ComparisonRow[];
  narrative: NarrativeCard[];
  finalCtaTitle: string;
  finalCtaSub: string;
}) {
  return (
    <MarketingShell>
      <section className={styles.hero}>
        <div className={styles.badge}>
          <span>◈</span>
          {badge}
        </div>
        <h1 className={styles.title}>
          {title} <span className={styles.titleAccent}>{titleAccent}</span>
        </h1>
        <p className={styles.sub}>{sub}</p>
        <div className={styles.heroCtas}>
          <Link href="/login?mode=signup" className={shellStyles.btnHeroPrimary}>
            Start Free →
          </Link>
        </div>
      </section>

      <section className={styles.tableSection}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th className={styles.metisCol}>Metis</th>
                <th>{competitorName}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className={styles.rowLabel}>{row.label}</td>
                  <td className={styles.metisCell}>{row.metis}</td>
                  <td>{row.competitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.narrative}>
        <div className={styles.narrativeGrid}>
          {narrative.map((card) => (
            <div key={card.title} className={styles.narrativeCard}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <h2 className={styles.finalCtaTitle}>{finalCtaTitle}</h2>
        <p className={styles.finalCtaSub}>{finalCtaSub}</p>
        <Link href="/login?mode=signup" className={shellStyles.btnHeroPrimary}>
          Create Free Account →
        </Link>
        <div className={styles.finalCtaNote}>NO CREDIT CARD · NO SALES CALL · JUST ANSWERS</div>
      </section>
    </MarketingShell>
  );
}
