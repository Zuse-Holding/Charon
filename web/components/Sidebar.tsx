"use client";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import styles from "./Sidebar.module.css";

const NAV = [
  { label: "Dashboard",       icon: "◈", href: "/app" },
  { label: "Intel Feed",      icon: "◆", href: "/intel-feed" },
  { label: "Reports",         icon: "⊞", href: "/reports" },
  { label: "Watchlist",       icon: "◎", href: "/watchlist" },
];

const SYSTEM_NAV = [
  { label: "Knowledge Graph", icon: "◉", href: "/knowledge-graph" },
  { label: "Settings",        icon: "⊙", href: "/settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo} onClick={() => router.push("/")} style={{ cursor: "pointer" }}>
        <div className={styles.logoMark}>CHARON</div>
        <div className={styles.logoSub}>ZUSE HOLDINGS // v0.1</div>
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

      <div className={styles.footer}>
        <span className={styles.dot} />
        <span className={styles.footerText}>GROQ · llama-3.1-8b</span>
        <button className={styles.signOut} onClick={signOut} title="Sign out">⏻</button>
      </div>
    </aside>
  );
}
