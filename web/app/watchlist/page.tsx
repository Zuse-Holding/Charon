"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EntityTag from "../../components/EntityTag";
import EmptyState from "../../components/EmptyState";
import styles from "./page.module.css";

interface WatchEntry {
  id: string;
  type: "company" | "person" | "product" | "creator";
  subject: string;
  addedAt: string;
  lastRefreshedAt?: string;
  refreshIntervalDays: number;
  ageDays: number;
  isStale: boolean;
  // Creator-only signal, from creator-snapshot-agent — null/0 for every
  // other type, and for a creator with no snapshots run yet.
  botScore: number | null;
  followerCount: number | null;
  lastSnapshotDate: string | null;
  snapshotCount: number;
  trajectoryScore: number | null;
  trajectoryLabel: string | null;
}

// Must match MIN_DATA_POINTS in src/lib/trajectory-score.ts — the point
// at which creator-snapshot-agent starts computing a trajectory instead
// of leaving it null.
const TRAJECTORY_MIN_DAYS = 7;

const TRAJECTORY_COPY: Record<string, { label: string; tone: "good" | "bad" | "warn" | "neutral" }> = {
  organic_growth: { label: "Organic growth", tone: "good" },
  staircase: { label: "Staircase pattern", tone: "bad" },
  declining: { label: "Declining", tone: "warn" },
  flat: { label: "Flat", tone: "neutral" },
};

function botScoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

export default function Watchlist() {
  const router = useRouter();
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
            <EmptyState
              icon="◎"
              title="Your Watchlist is empty"
              description={
                <>
                  Research a company, person, or product from the dashboard,
                  then click <strong>Watch</strong> on any report to track it here.
                </>
              }
              action={{ label: "Start Research", onClick: () => router.push("/app") }}
            />
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

                    {entry.type === "creator" && (
                      <div className={styles.signalRow}>
                        {entry.snapshotCount === 0 ? (
                          <span className={styles.signalPending}>
                            No snapshot yet — run creator-snapshot
                          </span>
                        ) : (
                          <>
                            {entry.botScore !== null && (
                              <span className={`${styles.badge} ${styles[botScoreTone(entry.botScore)]}`}>
                                Bot score {entry.botScore}
                              </span>
                            )}
                            {entry.trajectoryLabel && TRAJECTORY_COPY[entry.trajectoryLabel] ? (
                              <span className={`${styles.badge} ${styles[TRAJECTORY_COPY[entry.trajectoryLabel].tone]}`}>
                                {TRAJECTORY_COPY[entry.trajectoryLabel].label}
                                {entry.trajectoryScore !== null ? ` · ${entry.trajectoryScore}` : ""}
                              </span>
                            ) : (
                              <span className={styles.signalPending}>
                                Gathering trajectory — {entry.snapshotCount}/{TRAJECTORY_MIN_DAYS} days
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}

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
