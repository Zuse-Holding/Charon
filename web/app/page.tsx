"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import EntityTag from "../components/EntityTag";
import ReportViewer from "../components/ReportViewer";
import DeepDiveProgress from "../components/DeepDiveProgress";
import DeepDiveViewer from "../components/DeepDiveViewer";
import ErrorBoundary from "../components/ErrorBoundary";
import ResearchSkeleton from "../components/ResearchSkeleton";
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

export default function Dashboard() {
  const [runs, setRuns]               = useState<Run[]>([]);
  const [selected, setSelected]       = useState<Run | null>(null);
  const [report, setReport]           = useState<string>("");
  const [loading, setLoading]         = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<ActiveTab>("summary");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>("idle");
  const [deepDive, setDeepDive]       = useState<DeepDiveBundle | null>(null);
  const [pending, setPending]         = useState<{ subject: string; type: "company" | "person" | "product" } | null>(null);
  const selectedRef                   = useRef<Run | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/runs");
    if (res.ok) {
      const data: Run[] = await res.json();
      setRuns(data);
      return data;
    }
    return [];
  }, []);

  useEffect(() => {
    loadRuns().then(async (data) => {
      if (data.length > 0) await selectRun(data[0]);
    });
  }, [loadRuns]);

  async function selectRun(run: Run) {
    selectedRef.current = run;
    setSelected(run);
    setActiveTab("summary");
    setDeepDiveState("idle");
    setDeepDive(null);
    setLoading(true);
    try {
      const [reportRes, deepDiveRes] = await Promise.all([
        fetch(`/api/report?path=${encodeURIComponent(run.reportPath)}`),
        run.type === "company"
          ? fetch(`/api/deep-dive?company=${encodeURIComponent(run.subject)}`)
          : Promise.resolve(null),
      ]);
      if (reportRes.ok) setReport(await reportRes.text());
      else setReport("_Report file not found._");
      if (deepDiveRes?.ok) {
        const dd = await deepDiveRes.json();
        setDeepDive(dd);
        setDeepDiveState("done");
      }
    } finally {
      setLoading(false);
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

  function handleDeepDiveComplete(sections: DeepDiveSection[]) {
    if (!selected) return;
    const bundle: DeepDiveBundle = {
      company: selected.subject,
      generatedAt: new Date().toISOString(),
      durationMs: 0,
      sections,
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

  function handlePrint() {
    window.print();
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
                <div className={styles.empty}>
                  No research yet. Run your first query above.
                </div>
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
                      className={styles.actionBtn}
                      disabled={loading}
                      onClick={async () => {
                        if (!selected || loading) return;
                        setLoading(true);
                        try {
                          await fetch("/api/research", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ subject: selected.subject, type: selected.type }),
                          });
                          const data = await loadRuns();
                          const updated = data.find(r => r.subject === selected.subject && r.type === selected.type);
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
                      onClick={handlePrint}
                    >
                      Export PDF
                    </button>
                  </div>
                </div>

                {/* TAB BAR */}
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
                  {/* Deep dive progress overlay */}
                  {(deepDiveState === "confirming" || deepDiveState === "running") && selected && (
                    <DeepDiveProgress
                      company={selected.subject}
                      onComplete={handleDeepDiveComplete}
                      onCancel={() => setDeepDiveState("idle")}
                    />
                  )}

                  {/* Normal content when not in deep dive flow */}
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
