"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { detectEntityType } from "../lib/detect-entity-type";
import { useResearch } from "../lib/research-context";
import { useTier } from "../lib/tier-context";
import { AmbiguousOption, findAmbiguousMatch } from "../lib/ambiguous-entities";
import DisambiguationModal from "./DisambiguationModal";
import styles from "./Topbar.module.css";

type ResearchType = "company" | "person" | "product" | "political" | "creator";

interface TopbarProps {
  onResearchStart?: (subject: string, type: ResearchType) => void;
  onResearchComplete?: () => void;
}

export default function Topbar({ onResearchStart, onResearchComplete }: TopbarProps) {
  const [query, setQuery]       = useState("");
  const [type, setType]         = useState<ResearchType>("company");
  // Tracks whether the user has explicitly picked a type (pill click or
  // mobile dropdown) for the search currently being typed. Auto-detect
  // was overwriting a manual selection on every keystroke — click
  // "Person", start typing, and it'd silently flip back to "Company"
  // (the heuristic's fallback) since a partial word never matches the
  // "First Last" person pattern. Once the user picks manually, auto-
  // detect stays out of the way until the field is cleared again.
  const [typeManuallySet, setTypeManuallySet] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [status, setStatus]     = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [ambiguousOptions, setAmbiguousOptions] = useState<AmbiguousOption[] | null>(null);
  const router = useRouter();
  const { startResearch, completeResearch } = useResearch();
  const { can } = useTier();

  // Available types based on tier
  const availableTypes: { value: ResearchType; label: string; gated?: boolean }[] = [
    { value: "company",   label: "CO" },
    { value: "person",    label: "PERSON" },
    { value: "product",   label: "PRODUCT" },
    { value: "political", label: "POL", gated: !can("politicalAccess") },
    { value: "creator",   label: "CREATOR", gated: !can("creatorAccess") },
  ];

  async function handleRun() {
    if (!query.trim() || loading) return;

    // Gate political research on the frontend too
    if (type === "political" && !can("politicalAccess")) {
      setStatus("✗ Political research requires Pro or higher");
      setTimeout(() => setStatus(""), 4000);
      return;
    }

    if (type === "creator" && !can("creatorAccess")) {
      setStatus("✗ Creator research requires Pro or higher");
      setTimeout(() => setStatus(""), 4000);
      return;
    }

    // Known name collisions (e.g. "Alan Health" vs "Alan" the French
    // insurer) — ask which one instead of silently picking one, or
    // worse, mixing sources from both into one report.
    if (type === "company") {
      const ambiguous = findAmbiguousMatch(query);
      if (ambiguous) {
        setAmbiguousOptions(ambiguous.options);
        return;
      }
    }

    await runResearch(query.trim());
  }

  async function runResearch(subject: string) {
    setAmbiguousOptions(null);
    setLoading(true);
    setStatus(`Researching "${subject}"...`);
    setQuery("");
    setTypeManuallySet(false);

    startResearch(subject, type as "company" | "person" | "product");
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
        // Show upgrade hint if tier-blocked
        const msg = data.upgradeHint
          ? `✗ ${data.message} ${data.upgradeHint}`
          : `✗ Error: ${data.error ?? data.message ?? "unknown error"}`;
        setStatus(msg);
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
            placeholder="Research a company, person, product, or political figure..."
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              // Clearing the field resets to fresh auto-detect for the
              // next search rather than staying locked to a prior pick.
              if (!val.trim()) { setTypeManuallySet(false); return; }
              if (!typeManuallySet && val.trim().length > 2) {
                setType(detectEntityType(val.trim()) as ResearchType);
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && handleRun()}
          />
        </div>

        {/* Desktop pills */}
        <div className={styles.pills}>
          {availableTypes.map((t) => (
            <button
              key={t.value}
              className={`${styles.pill} ${type === t.value ? styles.active : ""} ${t.gated ? styles.gated ?? "" : ""}`}
              onClick={() => { if (!t.gated) { setType(t.value); setTypeManuallySet(true); } }}
              title={t.gated ? `Upgrade to Pro to unlock ${t.value} research` : undefined}
              style={t.gated ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              {t.label}
              {t.gated && " 🔒"}
            </button>
          ))}
        </div>

        {/* Mobile type selector */}
        <select
          className={styles.mobileSelect}
          value={type}
          onChange={(e) => { setType(e.target.value as ResearchType); setTypeManuallySet(true); }}
        >
          <option value="company">Company</option>
          <option value="person">Person</option>
          <option value="product">Product</option>
          {can("politicalAccess") && <option value="political">Political</option>}
          {can("creatorAccess") && <option value="creator">Creator</option>}
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

        <button className={styles.hamburger} onClick={() => setMenuOpen(true)}>☰</button>
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
              <span className={styles.drawerLogo}>METIS</span>
              <button className={styles.drawerClose} onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            {[
              { label: "Dashboard",       href: "/dashboard",       icon: "◈" },
              { label: "Research",        href: "/app",             icon: "◎" },
              { label: "Intel Feed",      href: "/intel-feed",      icon: "◆" },
              { label: "Reports",         href: "/reports",         icon: "⊞" },
              { label: "Watchlist",       href: "/watchlist",       icon: "◎" },
              { label: "Knowledge Graph", href: "/knowledge-graph", icon: "◉" },
              { label: "Settings",        href: "/settings",        icon: "⊙" },
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
            {/* Real href, not JS-only onClick — works via native browser
                navigation even if client hydration fails. */}
            <Link
              className={`${styles.drawerItem} ${styles.drawerItemDanger}`}
              href="/logout"
              onClick={() => setMenuOpen(false)}
            >
              <span className={styles.drawerIcon}>◐</span>
              Sign Out
            </Link>
          </div>
        </div>
      )}

      {ambiguousOptions && (
        <DisambiguationModal
          query={query.trim()}
          options={ambiguousOptions}
          onSelect={(opt) => runResearch(opt.subject)}
          onCancel={() => setAmbiguousOptions(null)}
        />
      )}
    </div>
  );
}
