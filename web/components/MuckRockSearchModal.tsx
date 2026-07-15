"use client";
import { useState } from "react";
import styles from "./CharonToolModal.module.css";

interface FoiaRequestEntry {
  title: string;
  url: string;
  status?: string;
  agency?: string;
  dateSubmitted?: string;
}

interface MuckRockResult {
  query: string;
  generatedAt: string;
  requests: FoiaRequestEntry[];
}

interface Props {
  onClose: () => void;
}

export default function MuckRockSearchModal({ onClose }: Props) {
  const [query, setQuery]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<MuckRockResult | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/muckrock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>MuckRock FOIA Search — Charon</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <p className={styles.subtitle}>
          Searches MuckRock&apos;s public archive of filed FOIA/public-records requests — a person, org, agency, or topic.
        </p>

        <form className={styles.form} onSubmit={runSearch}>
          <input
            className={styles.input}
            placeholder="Search query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button className={styles.submitBtn} type="submit" disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && <div className={styles.error}>{error}</div>}
        {loading && <div className={styles.loading}>Querying MuckRock…</div>}

        {result && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Results</span>
              <span className={`${styles.sectionStatus} ${styles.live}`}>{result.requests.length} found</span>
            </div>
            {result.requests.length === 0 && (
              <div className={styles.empty}>No FOIA requests found for &quot;{result.query}&quot;.</div>
            )}
            {result.requests.map((r, i) => (
              <div key={i} className={styles.entry}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className={styles.entryLink}>{r.title}</a>
                <div className={styles.entryMeta}>
                  {[r.agency, r.status, r.dateSubmitted].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
