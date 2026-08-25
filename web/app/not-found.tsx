import Link from "next/link";
import { MarketingShell } from "../components/marketing/MarketingShell";
import shellStyles from "../components/marketing/MarketingShell.module.css";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <MarketingShell>
      <section className={styles.hero}>
        <div className={styles.code}>404</div>
        <h1 className={styles.title}>That page doesn't exist.</h1>
        <p className={styles.sub}>
          The link might be broken, or the page moved. Try the homepage, or one of these.
        </p>
        <div className={styles.links}>
          <Link href="/" className={shellStyles.btnHeroPrimary}>Go home →</Link>
          <Link href="/pricing" className={shellStyles.btnHeroSecondary}>Pricing</Link>
          <Link href="/resources" className={shellStyles.btnHeroSecondary}>Resources</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
