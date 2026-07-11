"use client";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { useResearch } from "../lib/research-context";
import { useTier } from "../lib/tier-context";
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
  const { isInternal, tier, displayName } = useTier();
  const initials = displayName
    ? displayName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  // Internal accounts (Charon Protocol) skip the sidebar badge entirely —
  // that designator stays low-profile, visible only in Settings > Account
  // for the account holder themselves rather than displayed at a glance.
  const badge = tier && tier !== "internal" ? TIER_BADGE[tier] : undefined;

  async function signOut() {
    router.push("/logout");
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo} onClick={() => router.push("/")} style={{ cursor: "pointer" }}>
        <div className={styles.logoMark}>METIS</div>
        <div className={styles.logoSub}>ZUSE HOLDINGS</div>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navLabel}>WORKSPACE</div>
        {NAV.map((item) => (
          <div
            key={item.href}
            className={`${styles.navItem} ${pathname === item.href ? styles.active : ""}`}
            onClick={() => router.push(item.href)}
          >
            <span className={styles.icon}>{item.icon}</span>
            {item.label}
          </div>
        ))}
        <div className={styles.navLabel}>SYSTEM</div>
        {SYSTEM_NAV.map((item) => (
          <div
            key={item.href}
            className={`${styles.navItem} ${pathname === item.href ? styles.active : ""}`}
            onClick={() => router.push(item.href)}
          >
            <span className={styles.icon}>{item.icon}</span>
            {item.label}
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

      {displayName && (
        <div className={styles.userRow}>
          <div className={styles.userAvatar}>{initials}</div>
          <div className={styles.userName} title={displayName}>{displayName}</div>
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.dot} />
        <span className={styles.footerText}>
          {isInternal ? "CHARON · SELENE" : "GROQ · Selene"}
        </span>
        <button className={styles.signOut} onClick={signOut} title="Sign out">⏻</button>
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
