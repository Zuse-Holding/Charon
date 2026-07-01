"use client";
import { useEffect, useState } from "react";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EntityTag from "../../components/EntityTag";
import styles from "./page.module.css";

interface Run {
  id: string;
  type: "company" | "person" | "product";
  subject: string;
  generatedAt: string;
  reportPath: string;
}

export default function Reports() {
  const [runs, setRuns]         = useState<Run[]>([]);
  const [filter, setFilter]     = useState<string>("all");
  const [search, setSearch]     = useState("");
  const [rerunning, setRerunning] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/runs");
    if (res.ok) setRuns(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function rerun(run: Run) {
    if (rerunning) return;
    setRerunning(run.id);
    try {
      await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: run.subject, type: run.type }),
      });
      await load();
    } finally {
      setRerunning(null);
    }
  }

  const filtered = runs.filter((r) => {
    if (filter !== "all" && r.type !== filter) return false;
    if (search && !r.subject.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Topbar onResearchComplete={load} />

        <div className={styles.content}>
          <div className={styles.toolbar}>
            <input
              className={styles.search}
              type="text"
              placeholder="Search reports..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className={styles.filters}>
              {["all", "company", "person", "product"].map((f) => (
                <button
                  key={f}
                  className={`${styles.filterBtn} ${filter === f ? styles.active : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <span className={styles.resultCount}>
              {filtered.length} report{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>TYPE</th>
                  <th>SUBJECT</th>
                  <th>GENERATED</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.empty}>
                      No reports found. Run your first research query above.
                    </td>
                  </tr>
                )}
                {filtered.map((run) => (
                  <tr key={run.id}>
                    <td><EntityTag type={run.type} /></td>
                    <td className={styles.nameCell}>{run.subject}</td>
                    <td className={styles.monoCell}>{formatDate(run.generatedAt)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          className={styles.rowBtn}
                          onClick={async () => {
                            const res = await fetch(`/api/report?path=${encodeURIComponent(run.reportPath)}`);
                            if (res.ok) {
                              const text = await res.text();
                              const blob = new Blob([text], { type: "text/markdown" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `${run.subject.toLowerCase().replace(/\s+/g, "-")}.md`;
                              a.click();
                            }
                          }}
                        >
                          Export
                        </button>
                        <button
                          className={`${styles.rowBtn} ${styles.primary}`}
                          onClick={() => rerun(run)}
                          disabled={rerunning === run.id}
                        >
                          {rerunning === run.id ? "Running..." : "Re-run"}
                        </button>
                        <button
                          className={`${styles.rowBtn} ${styles.danger}`}
                          onClick={async () => {
                            await fetch("/api/runs", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: run.id }),
                            });
                            await load();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
