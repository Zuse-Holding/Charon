"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./OpsViews.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { AgentRunRow } from "@/lib/supabase/types";
import { relTime } from "@/lib/format";

// Usage — what Selene's runs did and what they'd cost (spec §4.5: "every
// run: tokens, cost, actions proposed, duration"). Straight off agent_runs.
//
// Cost note: jobs run on `claude -p` under a Pro/Max login, so est_cost_usd
// is what the CLI reports the run *would* cost at API rates — not money
// that left the account. It's shown as an "API-rate equivalent" and never
// written to the ledger as spend.

const WINDOW_DAYS = 30;

const JOB_LABEL: Record<string, string> = {
  inbox: "Inbox triage",
  finance: "Finance sweep",
  enrichment: "Lead enrichment",
  compliance: "Compliance clock",
  brief: "Weekly brief",
  executor: "Executor",
};

interface JobStats {
  job: string;
  runs: number;
  failed: number;
  actions: number;
  cost: number;
  avgSeconds: number | null;
  last: AgentRunRow;
}

function durationSeconds(r: AgentRunRow): number | null {
  if (!r.finished_at) return null;
  return (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 10 ? 2 : 0)}`;
}

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export default function UsageView() {
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);

  useEffect(() => {
    const db = supabaseRef.current ?? (supabaseRef.current = createClient());
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    db.from("agent_runs")
      .select("*")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setRuns((data as AgentRunRow[] | null) ?? []);
        setLoaded(true);
      });
  }, []);

  const byJob = new Map<string, JobStats>();
  for (const r of runs) {
    const s = byJob.get(r.job) ?? { job: r.job, runs: 0, failed: 0, actions: 0, cost: 0, avgSeconds: null, last: r };
    s.runs += 1;
    if (r.status === "failed") s.failed += 1;
    s.actions += r.actions_proposed ?? 0;
    s.cost += Number(r.est_cost_usd ?? 0);
    byJob.set(r.job, s);
  }
  for (const s of byJob.values()) {
    const durations = runs.filter((r) => r.job === s.job).map(durationSeconds).filter((d): d is number => d != null);
    s.avgSeconds = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  }
  const stats = [...byJob.values()].sort((a, b) => b.runs - a.runs);

  const totalCost = stats.reduce((a, s) => a + s.cost, 0);
  const totalFailed = stats.reduce((a, s) => a + s.failed, 0);
  const totalActions = stats.reduce((a, s) => a + s.actions, 0);
  const failures = runs.filter((r) => r.status === "failed").slice(0, 10);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Usage</div>
        <div className={styles.count}>last {WINDOW_DAYS} days</div>
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Runs</div>
          <div className={styles.tileValue}>{runs.length}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Failed</div>
          <div className={`${styles.tileValue} ${totalFailed ? styles.bad : ""}`}>{totalFailed}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Things queued for you</div>
          <div className={styles.tileValue}>{totalActions}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>API-rate equivalent</div>
          <div className={styles.tileValue}>{fmtUsd(totalCost)}</div>
        </div>
      </div>
      <div className={styles.hint}>
        Runs go through your Claude subscription, so the dollar figure is what they&apos;d cost at API rates, not what you paid.
      </div>

      {loaded && runs.length === 0 && (
        <div className={styles.empty}>No runs yet. Once the agent box is on its schedule, every run shows up here.</div>
      )}

      {stats.length > 0 && (
        <>
          <div className={styles.subTitle}>By job</div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Job</th><th className={styles.num}>Runs</th><th className={styles.num}>Failed</th>
                  <th className={styles.num}>Queued</th><th className={styles.num}>Avg time</th>
                  <th className={styles.num}>API-rate $</th><th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.job}>
                    <td>{JOB_LABEL[s.job] ?? s.job}</td>
                    <td className={styles.num}>{s.runs}</td>
                    <td className={`${styles.num} ${s.failed ? styles.bad : ""}`}>{s.failed}</td>
                    <td className={styles.num}>{s.actions}</td>
                    <td className={styles.num}>{fmtDuration(s.avgSeconds)}</td>
                    <td className={styles.num}>{fmtUsd(s.cost)}</td>
                    <td className={`${styles.mono} ${s.last.status === "failed" ? styles.bad : ""}`}>
                      {s.last.status === "running" ? "running now" : relTime(s.last.finished_at ?? s.last.started_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {failures.length > 0 && (
        <>
          <div className={styles.subTitle}>Recent failures</div>
          {failures.map((r) => (
            <div key={r.id} className={`${styles.row} ${styles.edgeBad}`}>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>{JOB_LABEL[r.job] ?? r.job}</div>
                <div className={styles.rowMeta}><span className={styles.mono}>{relTime(r.started_at)}</span></div>
                {r.log && <div className={styles.logLine}>{r.log}</div>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
