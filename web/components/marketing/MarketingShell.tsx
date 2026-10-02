import Link from "next/link";
import { DILIGENCE_URL } from "../../lib/products";
import styles from "./MarketingShell.module.css";

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/vs/crunchbase", label: "Compare" },
  { href: "/resources", label: "Resources" },
];

export function SiteNav({ subtitle = "BUSINESS INTELLIGENCE" }: { subtitle?: string }) {
  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.navLogo}>
        <div className={styles.logoIcon} />
        <div>
          <div className={styles.logoMark}>METIS</div>
          <div className={styles.logoSub}>{subtitle}</div>
        </div>
      </Link>
      <div className={styles.navCenter}>
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={styles.navLink}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className={styles.navRight}>
        <Link href="/login" className={styles.btnGhost}>Sign In</Link>
        <Link href="/login?mode=signup" className={styles.ctaPrimary}>Start Free</Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <span>© 2026 ZUSE HOLDINGS LLC</span>
      <div className={styles.footerLinks}>
        <Link href="/pricing" className={styles.footerLink}>Pricing</Link>
        <Link href="/resources" className={styles.footerLink}>Resources</Link>
        <a href={DILIGENCE_URL} className={styles.footerLink}>Diligence</a>
        <Link href="/privacy" className={styles.footerLink}>Privacy</Link>
        <Link href="/terms" className={styles.footerLink}>Terms</Link>
        <a href="mailto:support@metisanalytic.com" className={styles.footerLink}>support@metisanalytic.com</a>
      </div>
    </footer>
  );
}

export function PageEffects() {
  return (
    <>
      <div className={styles.gridBg} />
      <div className={styles.scanline} />
      <div className={styles.orbTop} />
      <div className={styles.orbBottom} />
    </>
  );
}

export function MarketingShell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className={styles.page}>
      <PageEffects />
      <SiteNav subtitle={subtitle} />
      {children}
      <SiteFooter />
    </div>
  );
}
