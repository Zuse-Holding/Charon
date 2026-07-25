"use client";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EntityTag from "../../components/EntityTag";
import ReportViewer from "../../components/ReportViewer";
import DeepDiveProgress from "../../components/DeepDiveProgress";
import DeepDiveViewer from "../../components/DeepDiveViewer";
import ErrorBoundary from "../../components/ErrorBoundary";
import ResearchSkeleton from "../../components/ResearchSkeleton";
import EmptyState from "../../components/EmptyState";
import styles from "./page.module.css";

interface Run {
  id: string;
  type: "company" | "person" | "product";
  subject: string;
  generatedAt: string;
  reportPath: string;
}

interface DeepDiveSection {
  title: string;
  content: string;
  riskLevel?: "high" | "medium" | "low";
}

interface DeepDiveBundle {
  company: string;
  generatedAt: string;
  durationMs: number;
  sections: DeepDiveSection[];
}

type ActiveTab = "summary" | "deep-dive";
type DeepDiveState = "idle" | "confirming" | "running" | "done";

// Mix of real companies and a couple fictional ones — gives new users
// something to click immediately, with the fictional ones serving as
// a small discoverable delight rather than a marketed feature.
const SUGGESTIONS: { name: string; type: "company" | "person" | "product" }[] = [
  { name: "Stripe", type: "company" },
  { name: "iPhone 15", type: "product" },
  { name: "Anthropic", type: "company" },
  { name: "Patrick Collison", type: "person" },
];

function Dashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [runs, setRuns]           = useState<Run[]>([]);
  const [selected, setSelected]   = useState<Run | null>(null);
  const [report, setReport]       = useState<string>("");
  const [loading, setLoading]     = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("summary");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>("idle");
  const [deepDive, setDeepDive]   = useState<DeepDiveBundle | null>(null);
  const [pending, setPending]     = useState<{ subject: string; type: "company" | "person" | "product" | "political" | "creator" } | null>(null);
  const selectedRef               = useRef<Run | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const pendingPollRef            = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/runs");
    if (res.ok) {
      const data: Run[] = await res.json();
      setRuns(data);
      return data;
    }
    return [];
  }, []);

  // Background-persistent search — a run kicked off from this tab (or a
  // different tab, or a previous session) keeps executing server-side
  // regardless of whether anyone's still watching. This checks for a
  // research_runs row still marked "pending" so a reload or a fresh tab
  // resumes showing progress instead of looking like nothing happened.
  // Returns whether a (non-stale) pending run was found.
  const checkPendingRun = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/runs/pending");
    if (!res.ok) return false;
    const data: { id: string; type: string; subject: string; generatedAt: string } | null = await res.json();
    if (!data) return false;

    // A pending row stuck for 10+ minutes means the process that was
    // running it almost certainly crashed or redeployed mid-run — treat
    // it as stalled rather than showing a spinner forever.
    const ageMs = Date.now() - new Date(data.generatedAt).getTime();
    if (ageMs > 10 * 60 * 1000) return false;

    const type: "company" | "person" | "product" | "political" | "creator" =
      data.type === "person" || data.type === "product" || data.type === "political" || data.type === "creator"
        ? data.type
        : "company";
    setPending({ subject: data.subject, type });
    return true;
  }, []);

  useEffect(() => {
    loadRuns().then(async (data) => {
      if (data.length > 0) await selectRun(data[0]);
    });
    checkPendingRun();
  }, [loadRuns, checkPendingRun]);

  // While a run is pending (whether triggered here, in another tab, or
  // before a reload), poll until it resolves, then refresh the feed.
  useEffect(() => {
    if (!pending) {
      if (pendingPollRef.current) { clearInterval(pendingPollRef.current); pendingPollRef.current = null; }
      return;
    }
    pendingPollRef.current = setInterval(async () => {
      const stillPending = await checkPendingRun();
      if (!stillPending) {
        setPending(null);
        const data = await loadRuns();
        if (data.length > 0) await selectRun(data[0]);
      }
    }, 4000);
    return () => {
      if (pendingPollRef.current) clearInterval(pendingPollRef.current);
    };
  }, [pending, checkPendingRun, loadRuns]);

  // Handle ?research=CompanyName from Intel Feed "Research X →" button
  useEffect(() => {
    const subject = searchParams.get("research");
    if (!subject) return;
    // Clear the param from URL without reload
    router.replace("/app");
    // Trigger research automatically
    runSuggestion(subject, "company");
  }, [searchParams]);
 useEffect(() => {
  if (!selected) { setIsWatching(false); return; }
  fetch("/api/watchlist")
    .then(r => r.json())
    .then((list: { subject: string; type: string }[]) => {
      const found = list.some(w => w.subject === selected.subject && w.type === selected.type);
      setIsWatching(found);
    })
    .catch(() => setIsWatching(false));
}, [selected]);

  async function selectRun(run: Run) {
    selectedRef.current = run;
    setSelected(run);
    setActiveTab("summary");
    setDeepDiveState("idle");
    setDeepDive(null);
    setLoading(true);
    try {
      const reportUrl = `/api/report?path=${encodeURIComponent(run.reportPath)}&subject=${encodeURIComponent(run.subject)}`;
      const reportRes = await fetch(reportUrl);
      if (reportRes.ok) setReport(await reportRes.text());
      else setReport(`_Report not available. Re-run to generate._`);
    } catch (err) {
      setReport("_Error loading report._");
    } finally {
      setLoading(false);
    }
  }

  async function runSuggestion(subject: string, type: "company" | "person" | "product") {
    setPending({ subject, type });
    setSelected(null);
    setReport("");
    try {
      await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, type }),
      });
      setPending(null);
      await new Promise(r => setTimeout(r, 1500));
      const data = await loadRuns();
      const created = data.find(r => r.subject === subject && r.type === type);
      if (created) await selectRun(created);
      else if (data.length > 0) await selectRun(data[0]);
    } catch {
      setPending(null);
    }
  }

  async function confirmDelete(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    setDeleteConfirm(null);
    await fetch("/api/runs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (selected?.id === id) { setSelected(null); setReport(""); setDeepDive(null); }
    await loadRuns();
  }

  function handleDeepDiveComplete(sections: { title: string; content: string; riskLevel?: string }[]) {
    if (!selected) return;
    const bundle: DeepDiveBundle = {
      company: selected.subject,
      generatedAt: new Date().toISOString(),
      durationMs: 0,
      sections: sections.map(s => ({
        ...s,
        riskLevel: s.riskLevel as "high" | "medium" | "low" | undefined,
      })),
    };
    setDeepDive(bundle);
    setDeepDiveState("done");
    setActiveTab("deep-dive");
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const isCompany = selected?.type === "company";

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar
          onResearchStart={(subject, type) => {
            setPending({ subject, type });
            setSelected(null);
            setReport("");
          }}
          onResearchComplete={async () => {
            setPending(null);
            await new Promise(r => setTimeout(r, 1500));
            const data = await loadRuns();
            if (data.length > 0) await selectRun(data[0]);
          }}
        />

        <div className={styles.content}>
          {/* FEED */}
          <div className={styles.feed}>
            <div className={styles.feedHeader}>
              <span className={styles.panelTitle}>Recent Research</span>
              <span className={styles.count}>{runs.length}</span>
            </div>
            <div className={styles.feedList}>
              {runs.length === 0 && (
                <EmptyState size="compact" icon="◎" title="No research yet" description="Run your first query above." />
              )}
              {pending && (
                <div className={`${styles.feedItem} ${styles.feedItemPending}`}>
                  <div className={styles.itemHeader}>
                    <span className={styles.pendingDot} />
                    <span className={styles.itemName}>{pending.subject}</span>
                  </div>
                  <div className={styles.itemTime}>Researching...</div>
                </div>
              )}
              {runs.map((run) => (
                <div
                  key={run.id}
                  className={`${styles.feedItem} ${selected?.id === run.id ? styles.selected : ""}`}
                  onClick={() => selectRun(run)}
                >
                  <div className={styles.itemHeader}>
                    <EntityTag type={run.type} />
                    <span className={styles.itemName}>{run.subject}</span>
                    <button
                      className={`${styles.deleteBtn} ${deleteConfirm === run.id ? styles.deleteBtnConfirm : ""}`}
                      onClick={(e) => { e.stopPropagation(); confirmDelete(run.id); }}
                      title={deleteConfirm === run.id ? "Click again to confirm" : "Delete"}
                    >
                      {deleteConfirm === run.id ? "Sure?" : "✕"}
                    </button>
                  </div>
                  <div className={styles.itemTime}>{formatDate(run.generatedAt)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* REPORT PANEL */}
          <div className={styles.reportPanel}>
            {pending ? (
              <div className={styles.reportBody} style={{ paddingTop: 32 }}>
                <ResearchSkeleton subject={pending.subject} type={pending.type} />
              </div>
            ) : !selected ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>◈</div>
                <div className={styles.emptyTitle}>Select a research report</div>
                <div className={styles.emptyText}>
                  Run a search above or pick an item from the feed
                </div>
                <div className={styles.suggestionRow}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.name}
                      className={styles.suggestionChip}
                      onClick={() => runSuggestion(s.name, s.type)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className={styles.reportHeader}>
                  <div>
                    <div className={styles.reportTitleRow}>
                      <EntityTag type={selected.type} />
                      <h1 className={styles.reportTitle}>{selected.subject}</h1>
                    </div>
                    <div className={styles.reportMeta}>
                      GENERATED {formatDate(selected.generatedAt)}
                    </div>
                  </div>
                  <div className={styles.reportActions}>
                  <button
  className={`${styles.actionBtn} ${isWatching ? styles.watching : ""}`}
  onClick={async () => {
    if (!selected) return;
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: selected.subject, type: selected.type }),
    });
    setIsWatching(true);
  }}
  title={isWatching ? "On your watchlist" : "Add to watchlist"}
>
  {isWatching ? "● Watching" : "◎ Watch"}
</button>
                    <button
                      className={styles.actionBtn}
                      disabled={loading}
                      onClick={async () => {
                        if (!selected || loading) return;
                        const currentSubject = selected.subject;
                        const currentType = selected.type;
                        setLoading(true);
                        try {
                          await fetch("/api/research", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ subject: currentSubject, type: currentType }),
                          });
                          await new Promise(r => setTimeout(r, 1500));
                          const data = await loadRuns();
                          const updated = data.find(r => r.subject === currentSubject && r.type === currentType);
                          if (updated) await selectRun(updated);
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      {loading ? "Running..." : "Re-run"}
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.primary}`}
                      onClick={() => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  const content = document.querySelector('[class*="reportBody"]');
  if (!content) return;
  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${selected?.subject ?? 'Report'} — Metis</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    body { font-family: Inter, sans-serif; color: #111; background: #fff; padding: 48px; max-width: 720px; margin: 0 auto; }
    @media print { @page { margin: 0.75in; size: letter; } body { padding: 0; } }
    .print-header { border-bottom: 3px solid #ff6b2b; padding-bottom: 20px; margin-bottom: 36px; }
    .print-brand { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; color: #ff6b2b; margin-bottom: 12px; }
    .print-title { font-family: 'Space Grotesk', sans-serif; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; color: #111; margin-bottom: 6px; }
    .print-date { font-size: 12px; color: #888; }
    .print-footer { margin-top: 48px; padding-top: 14px; border-top: 1px solid #ddd; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #bbb; display: flex; justify-content: space-between; letter-spacing: 0.04em; }
    * { background: #fff !important; color: #111 !important; border-color: #ddd !important; box-shadow: none !important; }
    [class*="sectionTitle"] { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 600; margin-bottom: 12px; }
    [class*="sectionNum"] { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #ff6b2b !important; letter-spacing: 0.1em; }
    [class*="metaLabel"] { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #ff6b2b !important; letter-spacing: 0.1em; }
    [class*="prose"] { font-size: 13px; line-height: 1.8; color: #333 !important; margin-bottom: 10px; }
    [class*="divider"] { background: #eee !important; height: 1px; margin: 28px 0; }
    [class*="riskBadge"] { border: 1px solid currentColor !important; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-family: 'JetBrains Mono', monospace; }
    [class*="sectionIcon"] { display: none; }
    [class*="printFooter"] { display: none; }
    [class*="metaRight"] { display: none; }
    [class*="reportMeta"] { display: none; }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="print-brand">METIS · ZUSE HOLDINGS · INTELLIGENCE REPORT</div>
    <div class="print-title">${selected?.subject ?? ''}</div>
    <div class="print-date">Generated ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}</div>
  </div>
  ${content.innerHTML}
  <div class="print-footer">
    <span>Generated by Metis · Powered by Selene</span>
    <span>metisanalytic.com</span>
  </div>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 800);
}}
                    >
                      Export PDF
                    </button>
                  </div>
                </div>

                {isCompany && (
                  <div className={styles.tabBar}>
                    <button
                      className={`${styles.tab} ${activeTab === "summary" ? styles.tabActive : ""}`}
                      onClick={() => setActiveTab("summary")}
                    >
                      Summary
                    </button>
                    <button
                      className={`${styles.tab} ${activeTab === "deep-dive" ? styles.tabActive : ""} ${deepDiveState === "idle" ? styles.tabLocked : ""}`}
                      onClick={() => {
                        if (deepDiveState === "idle") setDeepDiveState("confirming");
                        else if (deepDiveState === "done") setActiveTab("deep-dive");
                      }}
                    >
                      Deep Dive
                      {deepDiveState === "idle" && <span className={styles.tabBadge}>NEW</span>}
                      {deepDiveState === "done" && <span className={styles.tabBadgeDone}>✓</span>}
                    </button>
                  </div>
                )}

                <div className={styles.reportBody}>
                  {(deepDiveState === "confirming" || deepDiveState === "running") && selected && (
                    <DeepDiveProgress
                      company={selected.subject}
                      onComplete={handleDeepDiveComplete}
                      onCancel={() => setDeepDiveState("idle")}
                    />
                  )}

                  {deepDiveState !== "confirming" && deepDiveState !== "running" && (
                    <>
                      {activeTab === "summary" && (
                        loading ? (
                          <div className={styles.reportLoading}>
                            <span className={styles.loadingDot} />
                            Loading report...
                          </div>
                        ) : (
                          <ErrorBoundary>
                            <ReportViewer markdown={report} />
                          </ErrorBoundary>
                        )
                      )}
                      {activeTab === "deep-dive" && deepDive && (
                        <ErrorBoundary>
                          <DeepDiveViewer
                            company={deepDive.company}
                            generatedAt={deepDive.generatedAt}
                            durationMs={deepDive.durationMs}
                            sections={deepDive.sections}
                          />
                        </ErrorBoundary>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}


// Re-export wrapped in Suspense because useSearchParams requires it
const DashboardPage = Dashboard;

export default function DashboardWrapper() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
