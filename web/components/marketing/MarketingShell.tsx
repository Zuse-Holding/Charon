import Link from "next/link";
import styles from "./MarketingShell.module.css";

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/vs/crunchbase", label: "Compare" },
  { href: "/resources", label: "Resources" },
  { href: "/case-studies", label: "Case Studies" },
];

export function SiteNav() {
  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.navLogo}>
        <div className={styles.logoIcon} />
        <div>
          <div className={styles.logoMark}>METIS</div>
          <div className={styles.logoSub}>BUSINESS INTELLIGENCE</div>
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
      <span>© 2026 METIS ANALYTICS</span>
      <div className={styles.footerLinks}>
        <Link href="/pricing" className={styles.footerLink}>Pricing</Link>
        <Link href="/resources" className={styles.footerLink}>Resources</Link>
        <Link href="/case-studies" className={styles.footerLink}>Case Studies</Link>
        <Link href="/privacy" className={styles.footerLink}>Privacy</Link>
        <Link href="/terms" className={styles.footerLink}>Terms</Link>
        <a href="mailto:info@metisanalytic.com" className={styles.footerLink}>info@metisanalytic.com</a>
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

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <PageEffects />
      <SiteNav />
      {children}
      <SiteFooter />
    </div>
  );
}
