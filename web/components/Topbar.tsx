"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { detectEntityType } from "../lib/detect-entity-type";
import { useResearch } from "../lib/research-context";
import styles from "./Topbar.module.css";

type ResearchType = "company" | "person" | "product";

interface TopbarProps {
  onResearchStart?: (subject: string, type: ResearchType) => void;
  onResearchComplete?: () => void;
}

export default function Topbar({ onResearchStart, onResearchComplete }: TopbarProps) {
  const [query, setQuery]       = useState("");
  const [type, setType]         = useState<ResearchType>("company");
  const [loading, setLoading]   = useState(false);
  const [status, setStatus]     = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const { startResearch, completeResearch } = useResearch();

  async function handleRun() {
    if (!query.trim() || loading) return;
    const subject = query.trim();
    setLoading(true);
    setStatus(`Researching "${subject}"...`);
    setQuery("");

    // Update global context so other pages can see research in progress
    startResearch(subject, type);
    onResearchStart?.(subject, type);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, type }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(`✓ Done — "${subject}" added to feed`);
        completeResearch();
        onResearchComplete?.();
        router.refresh();
        setTimeout(() => setStatus(""), 4000);
      } else {
        setStatus(`✗ Error: ${data.error ?? "unknown error"}`);
        completeResearch();
        setTimeout(() => setStatus(""), 6000);
      }
    } catch {
      setStatus(`✗ Network error`);
      completeResearch();
      setTimeout(() => setStatus(""), 4000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.topbarWrap}>
      <div className={styles.topbar}>
        <div className={styles.searchWrap}>
          <span className={`${styles.pulse} ${loading ? styles.pulsing : ""}`} />
          <input
            className={styles.input}
            type="text"
            placeholder="Research a company, person, or product..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length > 2) {
                setType(detectEntityType(e.target.value.trim()));
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && handleRun()}
          />
        </div>

        {/* Desktop pills */}
        <div className={styles.pills}>
          {(["company", "person", "product"] as ResearchType[]).map((t) => (
            <button
              key={t}
              className={`${styles.pill} ${type === t ? styles.active : ""}`}
              onClick={() => setType(t)}
            >
              {t === "company" ? "CO" : t === "person" ? "PERSON" : "PRODUCT"}
            </button>
          ))}
        </div>

        {/* Mobile type selector */}
        <select
          className={styles.mobileSelect}
          value={type}
          onChange={(e) => setType(e.target.value as ResearchType)}
        >
          <option value="company">Company</option>
          <option value="person">Person</option>
          <option value="product">Product</option>
        </select>

        <button
          className={`${styles.runBtn} ${loading ? styles.loading : ""}`}
          onClick={handleRun}
          disabled={loading}
        >
          {loading ? "..." : "RUN RESEARCH"}
        </button>

        <div className={styles.right}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} />
            LLM ONLINE
          </div>
        </div>

        {/* Mobile hamburger */}
        <button className={styles.hamburger} onClick={() => setMenuOpen(true)}>
          ☰
        </button>
      </div>

      {status && (
        <div className={`${styles.statusBar} ${status.startsWith("✗") ? styles.statusError : status.startsWith("✓") ? styles.statusSuccess : ""}`}>
          {status}
        </div>
      )}

{/* Mobile nav drawer */}
      {menuOpen && (
        <div className={styles.drawerOverlay} onClick={() => setMenuOpen(false)}>
          <div className={styles.drawer} onClick={e => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <span className={styles.drawerLogo}>CHARON</span>
              <button className={styles.drawerClose} onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            {[
              { label: "Dashboard",      href: "/app",             icon: "◈" },
              { label: "Intel Feed",     href: "/intel-feed",      icon: "◆" },
              { label: "Reports",        href: "/reports",         icon: "⊞" },
              { label: "Watchlist",      href: "/watchlist",       icon: "◎" },
              { label: "Knowledge Graph",href: "/knowledge-graph", icon: "◉" },
              { label: "Settings",       href: "/settings",        icon: "⊙" },
            ].map(item => (
              <button
                key={item.href}
                className={styles.drawerItem}
                onClick={() => { router.push(item.href); setMenuOpen(false); }}
              >
                <span className={styles.drawerIcon}>{item.icon}</span>
                {item.label}
              </button>
            ))}
            <div className={styles.drawerDivider} />
            <button
              className={`${styles.drawerItem} ${styles.drawerItemDanger}`}
              onClick={() => { setMenuOpen(false); router.push("/logout"); }}
            >
              <span className={styles.drawerIcon}>⏻</span>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
