"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { detectEntityType } from "../lib/detect-entity-type";
import { useResearch } from "../lib/research-context";
import { useTier } from "../lib/tier-context";
import { AmbiguousOption, findAmbiguousMatch } from "../lib/ambiguous-entities";
import DisambiguationModal from "./DisambiguationModal";
import styles from "./Topbar.module.css";

type ResearchType = "company" | "person" | "product" | "political" | "creator";

// The candidate picker's "None of these" for a company (src/lib/nlp.ts
// UNLISTED_ANCHOR): a thin report that leaves same-named businesses out.
const UNLISTED_ANCHOR = "not listed online";

// A website typed in the search box ("sdsdentistry.com", "https://..."):
// the site drives the match, so no name lookup first (round 2, Fix 1).
// The agent server parses it; this only decides to skip the picker.
const HAS_WEBSITE = /(?:^|\s)(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:\/\S*)?(?=\s|$)/i;
const hasWebsite = (text: string) => HAS_WEBSITE.test(text) && !/\S+@\S+/.test(text);

interface Picker {
  query: string;
  title?: string;
  subtitle: string;
  options: AmbiguousOption[];
  onPick: (option: AmbiguousOption) => void;
}

interface TopbarProps {
  onResearchStart?: (subject: string, type: ResearchType) => void;
  onResearchComplete?: () => void;
}

export default function Topbar({ onResearchStart, onResearchComplete }: TopbarProps) {
  const [query, setQuery]       = useState("");
  // Company searches only (Fix 1): a city, state or website that pins down
  // which business, sent as "Name · Anchor" so reruns keep it.
  const [anchor, setAnchor]     = useState("");
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
  const [picker, setPicker]     = useState<Picker | null>(null);
  // "None of these" asks for a city or website first (round 2, Fix 4).
  // Running the same name again with the field still empty is the user
  // saying there's nothing to add: then the thin report runs.
  const [askedAnchorFor, setAskedAnchorFor] = useState<string | null>(null);
  const anchorRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { startResearch, completeResearch } = useResearch();
  const { can, isInternal } = useTier();

  // Available types based on tier. Creator research is Charon/internal-
  // only for now (see creatorAccess doc comment in web/lib/tier-context.tsx)
  // — hidden entirely for everyone else rather than shown locked, unlike
  // Political (a real Pro+ upsell). Showing a locked pill only makes
  // sense when upgrading would actually unlock it; here it wouldn't, and
  // hiding it also cuts down the pill count for the vast majority of users.
  const availableTypes: { value: ResearchType; label: string; gated?: boolean }[] = [
    { value: "company",   label: "CO" },
    { value: "person",    label: "PERSON" },
    { value: "product",   label: "PRODUCT" },
    { value: "political", label: "POL", gated: !can("politicalAccess") },
    ...(isInternal ? [{ value: "creator" as const, label: "CREATOR" }] : []),
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
      setStatus("✗ Creator research isn't available on your plan");
      setTimeout(() => setStatus(""), 4000);
      return;
    }

    const name = query.trim();
    // A website anywhere is a company search matched on that site (a
    // person search keeps its profile link as the person's anchor).
    if ((type !== "person" && hasWebsite(name)) || (type === "company" && hasWebsite(anchor))) {
      const where = anchor.trim().replace(/·/g, " ");
      return runResearch(where ? `${name.replace(/·/g, " ")} · ${where}` : name, "company");
    }
    if (type === "company") {
      const where = anchor.trim().replace(/·/g, " ");
      if (where) return runResearch(`${name} · ${where}`);
      if (askedAnchorFor && askedAnchorFor.toLowerCase() === name.toLowerCase()) {
        return runResearch(`${name} · ${UNLISTED_ANCHOR}`, "company");
      }
      // Known name collisions (e.g. "Alan Health" vs "Alan" the French
      // insurer) — ask which one instead of silently picking one, or
      // worse, mixing sources from both into one report.
      const ambiguous = findAmbiguousMatch(query);
      if (ambiguous) {
        setPicker({ query: name, subtitle: "Several companies match this name. Pick the one you mean.", options: ambiguous.options, onPick: (o) => runResearch(o.subject) });
        return;
      }
      return findCandidates(name, "company");
    }
    // Person reports always start from a picked match (Fix 5), unless the
    // subject already carries one ("Name · Organization").
    if (type === "person" && !name.includes("·")) return findCandidates(name, "person");
    await runResearch(name);
  }

  /** Lists who or what shares the name before any report runs (Fix 1, Fix 5). */
  async function findCandidates(name: string, kind: "company" | "person") {
    setLoading(true);
    setStatus(`Looking for matches for "${name}"...`);
    let data: { ok?: boolean; candidates?: (AmbiguousOption & { exact?: boolean })[]; suggestType?: "company" | "person"; namesFound?: boolean; error?: string; message?: string } = {};
    let status = 0;
    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: name, type: kind }),
      });
      status = res.status;
      data = await res.json();
    } catch {
      data = { ok: false };
    }
    setLoading(false);
    setStatus("");

    if (status === 401 || status === 403 || status === 429) {
      setStatus(`✗ ${data.error ?? data.message ?? "Couldn't look up matches."}`);
      setTimeout(() => setStatus(""), 6000);
      return;
    }
    if (!data.ok) {
      // Lookup unavailable: a company search runs as before (the report
      // still resolves on its own); a person search stops, since it needs a match.
      if (kind === "company") return runResearch(name, "company");
      setStatus("✗ Couldn't look up matches right now. Add where this person works after a · (e.g. Jane Smith · Acme) and run it again.");
      setTimeout(() => setStatus(""), 8000);
      return;
    }

    const options = data.candidates ?? [];
    if (data.suggestType) {
      const other = data.suggestType;
      setPicker({
        query: name,
        title: kind === "company" ? "No company found" : "No person found",
        subtitle: kind === "company"
          ? `Metis didn't find a business named "${name}". It reads like a person's name.`
          : `Metis didn't find a person named "${name}", but businesses use that name.`,
        options: [{ label: other === "person" ? "Search people instead" : "Search companies instead", description: `Look for "${name}" as a ${other}.`, subject: name }],
        onPick: () => { setType(other); setTypeManuallySet(true); findCandidates(name, other); },
      });
      return;
    }

    if (kind === "company") {
      // No business online: an honest thin report. One exact match: that's
      // it. A near match (ACCO Engineering -> ACCO Engineered Systems) is
      // shown, never picked for the user (round 2, Fix 4).
      if (options.length === 0) return runResearch(`${name} · ${UNLISTED_ANCHOR}`, "company");
      if (options.length === 1 && options[0].exact) return runResearch(options[0].subject, "company");
      const NONE = `${name} · ${UNLISTED_ANCHOR}`;
      setPicker({
        query: name,
        subtitle: options.some((o) => o.exact)
          ? "These businesses share this name. Pick yours, or add its city or website."
          : `No business is named exactly "${name}". Is it one of these?`,
        options: [...options, { label: "None of these", description: "Add its city, state or website, and Metis will look again.", subject: NONE }],
        onPick: (o) => {
          if (o.subject !== NONE) return runResearch(o.subject, "company");
          // Ask for an anchor rather than reporting a real business as unlisted.
          setQuery(name);
          setType("company");
          setTypeManuallySet(true);
          setAskedAnchorFor(name);
          setStatus(`Add the city, state or website for "${name}", then run it again. Run it with the field empty for a report on the name alone.`);
          setTimeout(() => anchorRef.current?.focus(), 0);
        },
      });
      return;
    }

    if (options.length === 0) {
      setStatus(data.namesFound
        ? `✗ Couldn't confirm a match for "${name}". Add where they work after a · (e.g. Jane Smith · Acme) and run it again.`
        : "✗ Metis couldn't find anyone by that name. Add where they work after a · (e.g. Jane Smith · Acme) and run it again.");
      setTimeout(() => setStatus(""), 8000);
      return;
    }
    setPicker({
      query: name,
      subtitle: "Pick the person you mean. If none of these is right, close this and add where they work.",
      options,
      onPick: (o) => runResearch(o.subject, "person"),
    });
  }

  async function runResearch(subject: string, researchType: ResearchType = type) {
    setPicker(null);
    setAskedAnchorFor(null);
    setLoading(true);
    setStatus(`Researching "${subject}"...`);
    setQuery("");
    setAnchor("");
    // The next search keeps this one's type (Oct 27 handoff, fix 1):
    // auto-detect read the next person's name as a company.
    setType(researchType);
    setTypeManuallySet(true);

    startResearch(subject, researchType as "company" | "person" | "product");
    onResearchStart?.(subject, researchType);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, type: researchType }),
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
            placeholder={
              type === "person"
                ? "Name, plus a company, school or city to narrow it down — e.g. Jane Smith, Austin TX"
                : "Research a company, person, product, or political figure..."
            }
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              // Clearing the field resets to fresh auto-detect for the
              // next search rather than staying locked to a prior pick.
              if (!val.trim()) { setTypeManuallySet(false); return; }
              if (!typeManuallySet) {
                const trimmed = val.trim();
                // "@" is an unambiguous handle/username signal — switch
                // immediately (no 3-character minimum like the general
                // heuristic below needs). Only for internal/Charon users:
                // creator research is hidden from everyone else, so
                // auto-selecting a type they can't use and can't even see
                // as a pill would just be confusing.
                if (isInternal && trimmed.startsWith("@")) {
                  setType("creator");
                } else if (trimmed.length > 2) {
                  setType(detectEntityType(trimmed) as ResearchType);
                }
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && handleRun()}
          />
        </div>

        {type === "company" && (
          <input
            ref={anchorRef}
            className={`${styles.input} ${styles.anchorInput}`}
            type="text"
            aria-label="City, state or website"
            placeholder="City, state or website"
            maxLength={100}
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRun()}
          />
        )}

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

      {picker && (
        <DisambiguationModal
          query={picker.query}
          title={picker.title}
          subtitle={picker.subtitle}
          options={picker.options}
          onSelect={(opt) => { setPicker(null); picker.onPick(opt); }}
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  );
}
