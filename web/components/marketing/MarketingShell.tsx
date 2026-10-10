import Link from "next/link";
import { BUSINESS_INTELLIGENCE_PATH, COMMITTEE_URL, DILIGENCE_URL } from "../../lib/products";
import styles from "./MarketingShell.module.css";

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/vs/crunchbase", label: "Compare" },
  { href: "/resources", label: "Resources" },
];

// `hub` is the metisanalytic.com front door: a plain Metis wordmark and no
// product nav, since the nav and sign-up buttons belong to Intelligence.
export function SiteNav({ subtitle = "INTELLIGENCE", hub = false }: { subtitle?: string; hub?: boolean }) {
  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.navLogo}>
        <div className={styles.logoIcon} />
        <div>
          <div className={styles.logoMark}>METIS</div>
          {!hub && <div className={styles.logoSub}>{subtitle}</div>}
        </div>
      </Link>
      {!hub && <>
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
      </>}
    </nav>
  );
}

export function SiteFooter({ hub = false }: { hub?: boolean }) {
  return (
    <footer className={styles.footer}>
      <span>© 2026 ZUSE HOLDINGS LLC</span>
      <div className={styles.footerLinks}>
        {hub
          ? <Link href={BUSINESS_INTELLIGENCE_PATH} className={styles.footerLink}>Intelligence</Link>
          : <Link href="/pricing" className={styles.footerLink}>Pricing</Link>}
        <Link href="/resources" className={styles.footerLink}>Resources</Link>
        <a href={DILIGENCE_URL} className={styles.footerLink}>Diligence</a>
        <a href={COMMITTEE_URL} className={styles.footerLink}>Committee</a>
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

export function MarketingShell({ children, subtitle, hub }: { children: React.ReactNode; subtitle?: string; hub?: boolean }) {
  return (
    <div className={styles.page}>
      <PageEffects />
      <SiteNav subtitle={subtitle} hub={hub} />
      {children}
      <SiteFooter hub={hub} />
    </div>
  );
}
