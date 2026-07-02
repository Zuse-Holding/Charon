"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { detectEntityType } from "../lib/detect-entity-type";
import styles from "./Topbar.module.css";

type ResearchType = "company" | "person" | "product";

interface TopbarProps {
  onResearchStart?: (subject: string, type: ResearchType) => void;
  onResearchComplete?: () => void;
}

export default function Topbar({ onResearchStart, onResearchComplete }: TopbarProps) {
  const [query, setQuery]     = useState("");
  const [type, setType]       = useState<ResearchType>("company");
  const [loading, setLoading] = useState(false);
  const [status, setStatus]   = useState<string>("");
  const router = useRouter();

  async function handleRun() {
    if (!query.trim() || loading) return;
    const subject = query.trim();
    setLoading(true);
    setStatus(`Researching "${subject}"...`);
    setQuery("");

    // Notify parent immediately so it can show skeleton
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
        onResearchComplete?.();
        router.refresh();
        setTimeout(() => setStatus(""), 4000);
      } else {
        setStatus(`✗ Error: ${data.error ?? "unknown error"}`);
        setTimeout(() => setStatus(""), 6000);
      }
    } catch {
      setStatus(`✗ Network error`);
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
      </div>
      {status && (
        <div className={`${styles.statusBar} ${status.startsWith("✗") ? styles.statusError : status.startsWith("✓") ? styles.statusSuccess : ""}`}>
          {status}
        </div>
      )}
    </div>
  );
}
