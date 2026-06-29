"use client";
import { useEffect, useState } from "react";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EntityTag from "../../components/EntityTag";
import styles from "./page.module.css";

interface WatchEntry {
  id: string;
  type: "company" | "person" | "product";
  subject: string;
  addedAt: string;
  lastRefreshedAt?: string;
  refreshIntervalDays: number;
  ageDays: number;
  isStale: boolean;
}

export default function Watchlist() {
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/watchlist");
    if (res.ok) setEntries(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  async function refresh(entry: WatchEntry) {
    setRefreshing(entry.id);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: entry.subject, type: entry.type }),
      });
      if (res.ok) {
        // Mark as refreshed so staleness bar resets
        await fetch("/api/watchlist", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id }),
        });
      }
      await load();
    } finally {
      setRefreshing(null);
    }
  }

  const staleCount = entries.filter((e) => e.isStale).length;

  function stalenessPercent(e: WatchEntry) {
    return Math.min(100, Math.round((e.ageDays / e.refreshIntervalDays) * 100));
  }

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar onResearchComplete={load} />

        <div className={styles.content}>
          <div className={styles.header}>
            <h2 className={styles.title}>Watchlist</h2>
            {staleCount > 0 && (
              <span className={styles.staleAlert}>{staleCount} STALE</span>
            )}
          </div>

          {entries.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>◎</div>
              <div className={styles.emptyTitle}>Your Watchlist is empty</div>
              <div className={styles.emptyText}>
                Research a company, person, or product — then use the CLI<br />
                <code>npm run watch -- "Company Name"</code>
              </div>
            </div>
          ) : (
            <div className={styles.grid}>
              {entries.map((entry) => {
                const pct = stalenessPercent(entry);
                return (
                  <div
                    key={entry.id}
                    className={`${styles.card} ${entry.isStale ? styles.stale : styles.fresh}`}
                  >
                    <div className={styles.cardHeader}>
                      <EntityTag type={entry.type} />
                      <span className={styles.cardName}>{entry.subject}</span>
                      {entry.isStale
                        ? <span className={styles.staleTag}>STALE · {entry.ageDays}d</span>
                        : <span className={styles.freshTag}>FRESH</span>
                      }
                    </div>

                    <div className={styles.staleBar}>
                      <div
                        className={`${styles.staleFill} ${entry.isStale ? styles.fillStale : pct > 50 ? styles.fillAging : styles.fillFresh}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className={styles.cardMeta}>
                      Last refreshed: {entry.lastRefreshedAt
                        ? new Date(entry.lastRefreshedAt).toLocaleDateString()
                        : "Never"}
                      &nbsp;·&nbsp; Interval: {entry.refreshIntervalDays}d
                    </div>

                    <div className={styles.cardFooter}>
                      <button
                        className={`${styles.cardBtn} ${entry.isStale ? styles.staleBtn : ""}`}
                        onClick={() => refresh(entry)}
                        disabled={refreshing === entry.id}
                      >
                        {refreshing === entry.id ? "Refreshing..." : "↻ Refresh"}
                      </button>
                      <button
                        className={`${styles.cardBtn} ${styles.removeBtn}`}
                        onClick={() => remove(entry.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
