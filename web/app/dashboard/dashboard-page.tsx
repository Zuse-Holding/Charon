"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import { useTier } from "../../lib/tier-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WatchlistItem {
  id: string;
  subject: string;
  type: string;
  last_researched_at: string | null;
}

interface IntelItem {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  pinned: boolean;
}

interface Run {
  id: string;
  subject: string;
  type: string;
  generated_at: string;
  tier_at_run?: string;
}

interface AdminStats {
  totalUsers: number;
  tierBreakdown: { tier: string; count: number }[];
  runsToday: number;
  deepDivesToday: number;
  deepDivesRunning: number;
  avgDurationMs: number;
}

type DashTab = "dashboard" | "admin";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function freshnessStatus(iso: string | null): "fresh" | "warn" | "stale" {
  if (!iso) return "stale";
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hrs < 24) return "fresh";
  if (hrs < 72) return "warn";
  return "stale";
}

const DOT: Record<string, string> = {
  fresh: "#34D399",
  warn:  "#E8A020",
  stale: "#F87171",
};

// ── Styles (inline to avoid extra CSS file) ───────────────────────────────────

const S = {
  shell: {
    display: "flex", height: "100vh", background: "#080C14",
    color: "#EDF2F7", fontFamily: "'Space Grotesk', sans-serif",
  } as React.CSSProperties,
  main: {
    flex: 1, display: "flex", flexDirection: "column" as const,
    overflow: "hidden",
  },
  body: {
    flex: 1, overflow: "auto", padding: "20px 24px",
    display: "flex", flexDirection: "column" as const, gap: 16,
  },
  tabBar: {
    display: "flex", gap: 4, padding: "12px 24px 0",
    borderBottom: "1px solid #1C2333",
  },
  tab: (active: boolean): React.CSSProperties => ({
    background: active ? "#1C2333" : "transparent",
    border: "none", borderRadius: "6px 6px 0 0",
    padding: "8px 20px", color: active ? "#EDF2F7" : "#6B7A99",
    fontSize: 12, fontWeight: active ? 700 : 400,
    cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" as const,
    borderBottom: active ? "2px solid #E8A020" : "2px solid transparent",
  }),
  row: {
    display: "flex", gap: 12,
  } as React.CSSProperties,
  panel: (accent?: string): React.CSSProperties => ({
    background: "#111827",
    border: `1px solid #1C2333`,
    borderTop: `2px solid ${accent ?? "#1C2333"}`,
    borderRadius: 10, padding: "16px 18px",
    flex: "1 1 0", minWidth: 0,
  }),
  panelTitle: {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
    color: "#6B7A99", textTransform: "uppercase" as const, marginBottom: 14,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    fontSize: 10, background: `${color}22`,
    color, border: `1px solid ${color}44`,
    borderRadius: 4, padding: "1px 6px", fontWeight: 700,
  }),
  card: {
    background: "#0E1420", border: "1px solid #1C2333",
    borderRadius: 7, padding: "9px 12px",
    marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 10,
  } as React.CSSProperties,
  stat: (color: string): React.CSSProperties => ({
    background: "#111827", border: "1px solid #1C2333",
    borderTop: `2px solid ${color}`,
    borderRadius: 10, padding: "14px 18px", flex: "1 1 0",
  }),
  statLabel: {
    fontSize: 11, color: "#6B7A99", letterSpacing: "0.1em",
    textTransform: "uppercase" as const, marginBottom: 6,
  } as React.CSSProperties,
  statValue: (color: string): React.CSSProperties => ({
    fontSize: 28, fontWeight: 700, color, lineHeight: 1,
    fontVariantNumeric: "tabular-nums" as const,
  }),
  statSub: {
    fontSize: 11, color: "#6B7A99", marginTop: 5,
  } as React.CSSProperties,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { isInternal, tier } = useTier();
  const router = useRouter();
  const [tab, setTab] = useState<DashTab>("dashboard");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [intel, setIntel] = useState<IntelItem[]>([]);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [time, setTime] = useState(new Date());

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load watchlist
  const loadWatchlist = useCallback(async () => {
    const res = await fetch("/api/watchlist");
    if (res.ok) setWatchlist(await res.json());
  }, []);

  // Load intel feed
  const loadIntel = useCallback(async () => {
    const res = await fetch("/api/intel-feed");
    if (res.ok) setIntel(await res.json());
  }, []);

  // Load recent runs
  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/runs");
    if (res.ok) setRecentRuns(await res.json());
  }, []);

  // Load admin stats (internal only)
  const loadAdminStats = useCallback(async () => {
    if (!isInternal) return;
    const res = await fetch("/api/admin/stats");
    if (res.ok) setAdminStats(await res.json());
  }, [isInternal]);

  useEffect(() => {
    loadWatchlist();
    loadIntel();
    loadRuns();
    if (isInternal) loadAdminStats();
  }, [loadWatchlist, loadIntel, loadRuns, loadAdminStats, isInternal]);

  // ── Brief items (derived from recent runs + watchlist) ──
  const briefItems = [
    recentRuns.length > 0 && {
      tag: "RESEARCH",
      text: `${recentRuns.length} reports in your history. Most recent: ${recentRuns[0]?.subject}.`,
      flag: "low",
    },
    watchlist.filter(w => freshnessStatus(w.last_researched_at) === "stale").length > 0 && {
      tag: "WATCHLIST",
      text: `${watchlist.filter(w => freshnessStatus(w.last_researched_at) === "stale").length} watchlist entities need a refresh.`,
      flag: "high",
    },
    {
      tag: "PLATFORM",
      text: `You're on the ${tier?.toUpperCase() ?? "BASIC"} tier.${isInternal ? " Jackal Protocol active." : ""}`,
      flag: "low",
    },
  ].filter(Boolean) as { tag: string; text: string; flag: string }[];

  // ── Render ──
  return (
    <div style={S.shell}>
      <Sidebar />
      <main style={S.main}>
        <Topbar />

        {/* Tab bar */}
        <div style={S.tabBar}>
          <button style={S.tab(tab === "dashboard")} onClick={() => setTab("dashboard")}>
            Dashboard
          </button>
          {isInternal && (
            <button style={S.tab(tab === "admin")} onClick={() => setTab("admin")}>
              Admin
            </button>
          )}
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#374151", alignSelf: "center", fontFamily: "monospace" }}>
            {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </div>

        <div style={S.body}>

          {/* ── DASHBOARD TAB ── */}
          {tab === "dashboard" && (
            <>
              {/* Row 1: Brief + Watchlist */}
              <div style={S.row}>
                {/* Morning Brief */}
                <div style={{ ...S.panel("#E8A020"), flex: "0 0 42%" }}>
                  <div style={S.panelTitle}>
                    Morning Brief
                    <span style={S.badge("#E8A020")}>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                  {briefItems.length === 0 && (
                    <div style={{ fontSize: 12, color: "#374151" }}>Run some research to populate your brief.</div>
                  )}
                  {briefItems.map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                        color: item.flag === "high" ? "#F87171" : item.flag === "med" ? "#E8A020" : "#6B7A99",
                        border: `1px solid currentColor`, borderRadius: 3,
                        padding: "1px 5px", whiteSpace: "nowrap" as const, marginTop: 2,
                      }}>{item.tag}</span>
                      <span style={{ fontSize: 12, color: "#EDF2F7", lineHeight: 1.5 }}>{item.text}</span>
                    </div>
                  ))}
                </div>

                {/* Watchlist */}
                <div style={S.panel("#2DD4BF")}>
                  <div style={S.panelTitle}>
                    Watchlist
                    <span style={S.badge("#2DD4BF")}>{watchlist.length} entities</span>
                  </div>
                  {watchlist.length === 0 && (
                    <div style={{ fontSize: 12, color: "#374151" }}>
                      No watchlist entities yet. Add companies from the research view.
                    </div>
                  )}
                  {watchlist.slice(0, 6).map((w) => {
                    const status = freshnessStatus(w.last_researched_at);
                    return (
                      <div key={w.id} style={S.card}>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: DOT[status], flexShrink: 0, marginTop: 4,
                          display: "inline-block",
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{w.subject}</div>
                          <div style={{ fontSize: 10, color: "#6B7A99" }}>
                            {w.type} · {w.last_researched_at ? timeAgo(w.last_researched_at) : "never researched"}
                          </div>
                        </div>
                        <button
                          onClick={() => router.push(`/app?research=${encodeURIComponent(w.subject)}`)}
                          style={{
                            background: "transparent", border: "1px solid #1C2333",
                            borderRadius: 5, padding: "3px 8px",
                            color: "#6B7A99", fontSize: 10, cursor: "pointer",
                          }}
                        >
                          Research →
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Row 2: Intel Feed + Recent Research */}
              <div style={S.row}>
                {/* Intel Feed */}
                <div style={S.panel("#4A90D9")}>
                  <div style={S.panelTitle}>
                    Intelligence Feed
                    <span style={S.badge("#4A90D9")}>live</span>
                  </div>
                  {intel.length === 0 && (
                    <div style={{ fontSize: 12, color: "#374151" }}>No feed items yet.</div>
                  )}
                  {intel.slice(0, 6).map((item) => (
                    <div key={item.id} style={{ ...S.card, cursor: "pointer" }}
                      onClick={() => item.url && window.open(item.url, "_blank")}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "#6B7A99", marginBottom: 3, fontWeight: 700, letterSpacing: "0.06em" }}>
                          {item.source}
                        </div>
                        <div style={{ fontSize: 12, color: "#EDF2F7", lineHeight: 1.5 }}>{item.title}</div>
                      </div>
                      <span style={{ fontSize: 10, color: "#374151", whiteSpace: "nowrap" as const }}>
                        {item.published_at ? timeAgo(item.published_at) : ""}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Recent Research */}
                <div style={{ ...S.panel("#6B7A99"), flex: "0 0 35%" }}>
                  <div style={S.panelTitle}>Recent Research</div>
                  {recentRuns.length === 0 && (
                    <div style={{ fontSize: 12, color: "#374151" }}>No research runs yet.</div>
                  )}
                  {recentRuns.slice(0, 8).map((run) => (
                    <div
                      key={run.id}
                      style={{ ...S.card, cursor: "pointer" }}
                      onClick={() => router.push("/app")}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{run.subject}</div>
                        <div style={{ fontSize: 10, color: "#6B7A99", marginTop: 2 }}>
                          {run.type} · {timeAgo(run.generated_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── ADMIN TAB (internal only) ── */}
          {tab === "admin" && isInternal && (
            <>
              {/* Stat row */}
              <div style={S.row}>
                <div style={S.stat("#34D399")}>
                  <div style={S.statLabel}>Total Users</div>
                  <div style={S.statValue("#34D399")}>{adminStats?.totalUsers ?? "—"}</div>
                </div>
                <div style={S.stat("#E8A020")}>
                  <div style={S.statLabel}>Researches Today</div>
                  <div style={S.statValue("#E8A020")}>{adminStats?.runsToday ?? recentRuns.filter(r => {
                    const today = new Date(); today.setHours(0,0,0,0);
                    return new Date(r.generated_at) >= today;
                  }).length}</div>
                </div>
                <div style={S.stat("#4A90D9")}>
                  <div style={S.statLabel}>Deep Dives Today</div>
                  <div style={S.statValue("#4A90D9")}>{adminStats?.deepDivesToday ?? "—"}</div>
                </div>
                <div style={S.stat("#F87171")}>
                  <div style={S.statLabel}>Deep Dives Running</div>
                  <div style={S.statValue("#F87171")}>{adminStats?.deepDivesRunning ?? 0}</div>
                  <div style={S.statSub}>right now</div>
                </div>
              </div>

              {/* Tier breakdown + recent runs */}
              <div style={S.row}>
                {/* Tier breakdown */}
                <div style={{ ...S.panel("#E8A020"), flex: "0 0 280px" }}>
                  <div style={S.panelTitle}>Users by Tier</div>
                  {(adminStats?.tierBreakdown ?? []).map((t) => (
                    <div key={t.tier} style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", padding: "8px 0",
                      borderBottom: "1px solid #1C2333",
                    }}>
                      <span style={{ fontSize: 12, textTransform: "capitalize" as const }}>{t.tier}</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: "#E8A020", fontVariantNumeric: "tabular-nums" as const }}>
                        {t.count}
                      </span>
                    </div>
                  ))}
                  {!adminStats && (
                    <div style={{ fontSize: 12, color: "#374151" }}>
                      Create <code style={{ fontSize: 11 }}>/api/admin/stats</code> route to populate.
                    </div>
                  )}
                </div>

                {/* All recent runs */}
                <div style={S.panel("#4A90D9")}>
                  <div style={S.panelTitle}>
                    All Recent Research
                    <span style={S.badge("#4A90D9")}>{recentRuns.length} total</span>
                  </div>
                  {recentRuns.map((run) => (
                    <div key={run.id} style={S.card}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{run.subject}</div>
                        <div style={{ fontSize: 10, color: "#6B7A99", marginTop: 2 }}>
                          {run.type} · {timeAgo(run.generated_at)}
                          {run.tier_at_run && ` · ${run.tier_at_run}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Note about admin stats route */}
              <div style={{
                fontSize: 11, color: "#374151", padding: "8px 12px",
                background: "#0E1420", border: "1px solid #1C2333",
                borderRadius: 7,
              }}>
                ⚠ Full admin stats (user count, tier breakdown, active sessions) require <code>/api/admin/stats</code> — build next session.
                Current run counts are pulled from your own session only.
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
