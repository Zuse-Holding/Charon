"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./AgentRunStatus.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import { subscribeToApprovalQueue, subscribeToAgentRuns } from "../../lib/realtime";
import type { AgentRunRow } from "@/lib/supabase/types";

// The Selene status ring (SELENE_OS_SPEC.md §5 signature element): a thin
// cyan moon-phase ring. Full = all runs green. Waning/gapped = pending
// approvals or a failed run — gap size is proportional to open queue items.
// One glance = system health.

const RADIUS = 11;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP_PER_PENDING = 0.07; // each open approval eats ~7% of the ring
const MAX_GAP = 0.82; // never fully vanish — there's always a core

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AgentRunStatus() {
  const [pendingCount, setPendingCount] = useState(0);
  const [lastRun, setLastRun] = useState<AgentRunRow | null>(null);
  // Created lazily (client-only) so this component never touches Supabase
  // during SSR/build, when env vars may not be present.
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);

  useEffect(() => {
    const supabase = supabaseRef.current ?? (supabaseRef.current = createClient());
    let cancelled = false;

    Promise.all([
      supabase.from("approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(1),
    ]).then(([queueRes, runRes]) => {
      if (cancelled) return;
      setPendingCount(queueRes.count ?? 0);
      const rows = runRes.data as AgentRunRow[] | null;
      setLastRun(rows?.[0] ?? null);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function refetchPendingCount() {
      const supabase = supabaseRef.current ?? (supabaseRef.current = createClient());
      supabase
        .from("approval_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .then(({ count }) => setPendingCount(count ?? 0));
    }

    const unsubQueue = subscribeToApprovalQueue({
      onInsert: refetchPendingCount,
      onUpdate: refetchPendingCount,
    });
    const unsubRuns = subscribeToAgentRuns({
      onInsert: (row) => setLastRun((prev) => (!prev || new Date(row.started_at) >= new Date(prev.started_at) ? row : prev)),
      onUpdate: (row) => setLastRun((prev) => (!prev || new Date(row.started_at) >= new Date(prev.started_at) ? row : prev)),
    });

    return () => {
      unsubQueue();
      unsubRuns();
    };
  }, []);

  const failed = lastRun?.status === "failed";
  const running = lastRun?.status === "running";

  const gapFraction = failed
    ? MAX_GAP
    : Math.min(pendingCount * GAP_PER_PENDING, MAX_GAP);
  const arcLength = (1 - gapFraction) * CIRCUMFERENCE;

  const tone = failed ? "tone-bad" : pendingCount > 0 ? "tone-warn" : "tone-ok";
  const strokeColor = failed ? "var(--danger)" : pendingCount > 0 ? "var(--ember)" : "var(--selene)";

  const topText = failed
    ? "run failed"
    : running
    ? "running…"
    : pendingCount > 0
    ? `${pendingCount} pending`
    : "all clear";
  const bottomText = lastRun ? `${lastRun.job} · ${relTime(lastRun.finished_at ?? lastRun.started_at)}` : "no runs yet";

  return (
    <div className={`${styles.root} ${styles[tone]}`} title="Selene status">
      <div className={styles.ringWrap}>
        <svg className={styles.ring} viewBox="0 0 26 26">
          <circle className={styles.ringTrack} cx="13" cy="13" r={RADIUS} />
          <circle
            className={styles.ringArc}
            cx="13"
            cy="13"
            r={RADIUS}
            stroke={strokeColor}
            strokeDasharray={`${arcLength} ${CIRCUMFERENCE}`}
          />
        </svg>
      </div>
      <div className={styles.readout}>
        <div className={styles.readoutTop}>{topText}</div>
        <div className={styles.readoutBottom}>{bottomText}</div>
      </div>
    </div>
  );
}
