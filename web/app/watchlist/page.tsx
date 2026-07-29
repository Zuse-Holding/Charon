"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EntityTag from "../../components/EntityTag";
import EmptyState from "../../components/EmptyState";
import { useTier } from "../../lib/tier-context";
import styles from "./page.module.css";

interface DiscoveryCandidate {
  id: string;
  raw_candidate: string;
  platform: string;
  niche: string;
  source_query: string;
  status: "pending" | "promoted" | "rejected";
  notes: string | null;
  last_seen_at: string;
}

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
  const { can } = useTier();
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryStatus, setDiscoveryStatus] = useState<"pending" | "rejected">("pending");
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/watchlist");
    if (res.ok) setEntries(await res.json());
  }

  async function loadCandidates(status: "pending" | "rejected") {
    setDiscoveryLoading(true);
    try {
      const res = await fetch(`/api/creator-discovery?status=${status}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load candidates");
      setCandidates(data.candidates ?? []);
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscoveryLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (discoveryOpen) loadCandidates(discoveryStatus); }, [discoveryOpen, discoveryStatus]);

  async function runDiscoveryNow() {
    setDiscoveryRunning(true);
    setDiscoveryError(null);
    try {
      const res = await fetch("/api/creator-discovery", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Discovery run failed");
      await loadCandidates(discoveryStatus);
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscoveryRunning(false);
    }
  }

  async function reviewCandidate(candidateId: string, action: "promote" | "reject") {
    setReviewingId(candidateId);
    setDiscoveryError(null);
    try {
      const reason = action === "reject" ? window.prompt("Reason for rejecting (optional):") ?? undefined : undefined;
      const res = await fetch("/api/creator-discovery/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Review action failed");
      await loadCandidates(discoveryStatus);
      if (action === "promote") await load();
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewingId(null);
    }
  }

  async function runSnapshotNow() {
    setSnapshotting(true);
    setSnapshotError(null);
    try {
      const res = await fetch("/api/creator-snapshot", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Snapshot run failed");
      await load();
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : String(err));
    } finally {
      setSnapshotting(false);
    }
  }

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
  const hasCreators = entries.some((e) => e.type === "creator");

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
            {hasCreators && (
              <button
                className={styles.snapshotBtn}
                onClick={runSnapshotNow}
                disabled={snapshotting}
              >
                {snapshotting ? "Running snapshot..." : "↻ Run snapshot now"}
              </button>
            )}
          </div>
          {snapshotError && (
            <div className={styles.snapshotErrorBanner}>{snapshotError}</div>
          )}

          {can("creatorAccess") && (
            <div className={styles.discoveryPanel}>
              <button className={styles.discoveryToggle} onClick={() => setDiscoveryOpen((o) => !o)}>
                {discoveryOpen ? "▾" : "▸"} Discovery — creators surfaced by trend scraping, not yet reviewed
              </button>

              {discoveryOpen && (
                <div className={styles.discoveryBody}>
                  <div className={styles.discoveryControls}>
                    <div className={styles.discoveryTabs}>
                      <button
                        className={`${styles.discoveryTab} ${discoveryStatus === "pending" ? styles.discoveryTabActive : ""}`}
                        onClick={() => setDiscoveryStatus("pending")}
                      >
                        Pending
                      </button>
                      <button
                        className={`${styles.discoveryTab} ${discoveryStatus === "rejected" ? styles.discoveryTabActive : ""}`}
                        onClick={() => setDiscoveryStatus("rejected")}
                      >
                        Rejected
                      </button>
                    </div>
                    <button className={styles.snapshotBtn} onClick={runDiscoveryNow} disabled={discoveryRunning}>
                      {discoveryRunning ? "Running discovery..." : "↻ Run discovery now"}
                    </button>
                  </div>

                  {discoveryError && <div className={styles.snapshotErrorBanner}>{discoveryError}</div>}

                  {discoveryLoading ? (
                    <div className={styles.signalPending}>Loading…</div>
                  ) : candidates.length === 0 ? (
                    <div className={styles.signalPending}>
                      {discoveryStatus === "pending" ? "No pending candidates — run discovery to look for some." : "Nothing rejected yet."}
                    </div>
                  ) : (
                    <div className={styles.discoveryList}>
                      {candidates.map((c) => (
                        <div key={c.id} className={styles.discoveryRow}>
                          <div className={styles.discoveryRowInfo}>
                            <span className={styles.discoveryCandidateName}>{c.raw_candidate}</span>
                            <span className={styles.discoveryMeta}>
                              {c.niche} · "{c.source_query}"{c.notes ? ` · ${c.notes}` : ""}
                            </span>
                          </div>
                          <div className={styles.discoveryActions}>
                            {c.status === "pending" && (
                              <button
                                className={styles.discoveryRejectBtn}
                                onClick={() => reviewCandidate(c.id, "reject")}
                                disabled={reviewingId === c.id}
                              >
                                Reject
                              </button>
                            )}
                            <button
                              className={styles.discoveryPromoteBtn}
                              onClick={() => reviewCandidate(c.id, "promote")}
                              disabled={reviewingId === c.id}
                            >
                              {c.status === "rejected" ? "Promote anyway" : "Promote"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
