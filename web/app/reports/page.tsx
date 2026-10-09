"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import Topbar from "../../components/Topbar";
import EntityTag from "../../components/EntityTag";
import EmptyState from "../../components/EmptyState";
import { Skeleton, Spinner } from "../../components/Skeleton";
import styles from "./page.module.css";

interface Run {
  id: string;
  type: "company" | "person" | "product";
  subject: string;
  generatedAt: string;
  reportPath: string;
}

export default function Reports() {
  const router = useRouter();
  const [runs, setRuns]         = useState<Run[]>([]);
  const [filter, setFilter]     = useState<string>("all");
  const [search, setSearch]     = useState("");
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [loaded, setLoaded]     = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/runs");
      if (res.ok) setRuns(await res.json());
    } finally {
      setLoaded(true);
    }
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
              {loaded ? `${filtered.length} report${filtered.length !== 1 ? "s" : ""}` : "Loading…"}
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
                {!loaded && [0, 1, 2, 3, 4].map((i) => (
                  <tr key={`ghost-${i}`} aria-hidden>
                    <td><Skeleton width={58} height={16} /></td>
                    <td><Skeleton width={[180, 130, 220, 150, 200][i]} height={12} /></td>
                    <td><Skeleton width={120} height={9} /></td>
                    <td>
                      <div className={styles.rowActions}>
                        <Skeleton width={56} height={24} />
                        <Skeleton width={60} height={24} />
                        <Skeleton width={56} height={24} />
                      </div>
                    </td>
                  </tr>
                ))}
                {loaded && filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.empty}>
                      <EmptyState
                        size="compact"
                        icon="⊞"
                        title="No reports found"
                        description="Run your first research query above."
                        action={{ label: "Start Research", onClick: () => router.push("/app") }}
                      />
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
                          {rerunning === run.id ? <><Spinner size={10} /> Running...</> : "Re-run"}
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
