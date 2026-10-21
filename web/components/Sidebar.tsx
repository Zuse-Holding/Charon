"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { useResearch } from "../lib/research-context";
import { useTier } from "../lib/tier-context";
import { BUSINESS_INTELLIGENCE_PATH, DILIGENCE_URL } from "../lib/products";
import { upgradeTarget, usageRows } from "../lib/usage";
import { Spinner } from "./Skeleton";
import styles from "./Sidebar.module.css";

const NAV = [
  { label: "Dashboard",       icon: "◈", href: "/dashboard" },
  { label: "Research",        icon: "◎", href: "/app" },
  { label: "Intel Feed",      icon: "◆", href: "/intel-feed" },
  { label: "Reports",         icon: "⊞", href: "/reports" },
  { label: "Watchlist",       icon: "◎", href: "/watchlist" },
];


const SYSTEM_NAV = [
  { label: "Knowledge Graph", icon: "◉", href: "/knowledge-graph" },
  { label: "Settings",        icon: "⊙", href: "/settings" },
];

// Badge shown for every tier, not just internal — label + accent color.
const TIER_BADGE: Record<string, { label: string; color: string }> = {
  internal: { label: "◈ CHARON",          color: "#E8A020" },
  team:     { label: "◈ TEAM",            color: "#4A90D9" },
  pro:      { label: "◈ PRO",             color: "#2DD4BF" },
  basic:    { label: "◈ BASIC",           color: "#6B7A99" },
  free:     { label: "◈ FREE",            color: "#6B7A99" },
  trial:    { label: "◈ TRIAL",           color: "#2DD4BF" },
};

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();
  const { pending } = useResearch();
  const { isInternal, tier, displayName, monthlyUsage, monthlyDeepDiveUsage, windowUsage } = useTier();
  const initials = displayName
    ? displayName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  // Internal accounts (Charon Protocol) skip the sidebar badge entirely —
  // that designator stays low-profile, visible only in Settings > Account
  // for the account holder themselves rather than displayed at a glance.
  const badge = tier && tier !== "internal" ? TIER_BADGE[tier] : undefined;

  // Usage meters + upgrade prompt. Free/Basic always see the upgrade
  // button; Pro only once a cap is near, since Team is a sales email.
  const usage = usageRows({ monthlyUsage, monthlyDeepDiveUsage, windowUsage });
  const nearLimit = usage.some(r => r.status !== "ok");
  const upgrade = upgradeTarget(tier);
  const showUpgrade = !!upgrade && (tier !== "pro" || nearLimit);

  // Nav items are click-handlers rather than <Link>s, so there's no
  // built-in feedback between the click and the next page rendering.
  // Run the push in a transition and spin the clicked item until it lands.
  const [navPending, startNav] = useTransition();
  const [navTarget, setNavTarget] = useState<string | null>(null);
  function go(href: string) {
    if (href === pathname) return;
    setNavTarget(href);
    startNav(() => router.push(href));
  }
  const isLoading = (href: string) => navPending && navTarget === href;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo} onClick={() => router.push(BUSINESS_INTELLIGENCE_PATH)} style={{ cursor: "pointer" }}>
        <div className={styles.logoMark}>METIS</div>
        <div className={styles.logoSub}>INTELLIGENCE</div>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navLabel}>WORKSPACE</div>
        {NAV.map((item) => (
          <div
            key={item.href}
            className={`${styles.navItem} ${pathname === item.href || isLoading(item.href) ? styles.active : ""}`}
            onClick={() => go(item.href)}
            onMouseEnter={() => router.prefetch(item.href)}
          >
            <span className={styles.icon}>{item.icon}</span>
            {item.label}
            {isLoading(item.href) && (
              <span className={styles.navSpinner}><Spinner size={10} color="var(--orange)" label={`Opening ${item.label}`} /></span>
            )}
          </div>
        ))}
        <div className={styles.navLabel}>PRODUCTS</div>
        <a className={styles.navItem} href={DILIGENCE_URL}>
          <span className={styles.icon}>◇</span>
          Diligence ↗
        </a>
        <div className={styles.navLabel}>SYSTEM</div>
        {SYSTEM_NAV.map((item) => (
          <div
            key={item.href}
            className={`${styles.navItem} ${pathname === item.href || isLoading(item.href) ? styles.active : ""}`}
            onClick={() => go(item.href)}
            onMouseEnter={() => router.prefetch(item.href)}
          >
            <span className={styles.icon}>{item.icon}</span>
            {item.label}
            {isLoading(item.href) && (
              <span className={styles.navSpinner}><Spinner size={10} color="var(--orange)" label={`Opening ${item.label}`} /></span>
            )}
          </div>
        ))}
      </nav>

      {pending && (
        <div className={styles.researchToast} onClick={() => router.push("/app")}>
          <span className={styles.toastDot} />
          <span className={styles.toastText}>
            Researching {pending.subject}...
          </span>
        </div>
      )}

      {(usage.length > 0 || showUpgrade) && (
        <div className={`${styles.planCard} ${nearLimit ? styles.planCardWarn : ""}`}>
          {usage.map(row => (
            <div key={row.key} className={styles.meter}>
              <div className={styles.meterHead}>
                <span>{row.label} <span className={styles.meterTag}>· {row.periodTag}</span></span>
                <span className={`${styles.meterCount} ${row.status !== "ok" ? styles[row.status] : ""}`}>
                  {row.used}/{row.limit}
                </span>
              </div>
              <div className={styles.meterTrack}>
                <div
                  className={`${styles.meterFill} ${row.status !== "ok" ? styles[row.status] : ""}`}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
              {row.status !== "ok" && (
                <div className={`${styles.meterNote} ${styles[row.status]}`}>
                  {row.status === "danger" ? "Limit reached" : "Almost out"}{row.resets ? ` · resets ${row.resets}` : ""}
                </div>
              )}
            </div>
          ))}
          {showUpgrade && upgrade && (
            <>
              {!nearLimit && <div className={styles.planPitch}>{upgrade.pitch}</div>}
              <a className={styles.upgradeBtn} href={upgrade.href}>{upgrade.label} →</a>
            </>
          )}
        </div>
      )}

      {displayName && (
        <div className={styles.userRow}>
          <div className={styles.userAvatar}>{initials}</div>
          <div className={styles.userName} title={displayName}>{displayName}</div>
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.dot} />
        <span className={styles.footerText}>
          {/* Charon is the admin account's agent; customers never see it
              or which model provider serves them (Fix 6). */}
          {isInternal ? "CHARON · SELENE" : "Selene"}
        </span>
        {/* Real href, not a JS-only onClick — works via native browser
            navigation even if client hydration fails (e.g. the SSO/proxy
            interference some corporate laptops hit), so sign-out never
            silently stops responding. */}
        <Link className={styles.signOut} href="/logout" title="Sign out" aria-label="Sign out">
          {/* Inline SVG, not the ⏻ glyph — Windows fonts lack U+23FB and render a box. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 3v9" />
            <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
          </svg>
        </Link>
      </div>

      {badge && (
        <div style={{
          margin: "0 12px 12px",
          background: `${badge.color}18`,
          border: `1px solid ${badge.color}66`,
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 10,
          fontWeight: 700,
          color: badge.color,
          letterSpacing: "0.1em",
          textAlign: "center",
        }}>
          {badge.label}
        </div>
      )}
    </aside>
  );
}
