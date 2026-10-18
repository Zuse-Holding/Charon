import { MetisFooter, MetisHeader } from "../../metis-ui";
import { BUSINESS_INTELLIGENCE_PATH } from "../../lib/products";
import styles from "./MarketingShell.module.css";

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/vs/crunchbase", label: "Compare" },
  { href: "/resources", label: "Resources" },
];

// The shared Metis header (web/metis-ui), same on every Metis site. `hub` is
// the metisanalytic.com front door: the plain Metis mark, no Intelligence
// nav or sign-up, since those belong to Intelligence.
export function SiteNav({ hub = false }: { hub?: boolean }) {
  if (hub) return <MetisHeader product="hub" />;
  return (
    <MetisHeader
      product="intelligence"
      homeHref={BUSINESS_INTELLIGENCE_PATH}
      links={NAV_LINKS}
      actions={
        <>
          <a href="/login" className="m-btn m-btn-ghost">Sign in</a>
          <a href="/login?mode=signup" className="m-btn m-btn-primary">Get started</a>
        </>
      }
    />
  );
}

export function SiteFooter() {
  return <MetisFooter product="intelligence" />;
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

export function MarketingShell({ children, hub }: { children: React.ReactNode; hub?: boolean }) {
  return (
    <div className={styles.page}>
      <PageEffects />
      <SiteNav hub={hub} />
      {children}
      <SiteFooter />
    </div>
  );
}
