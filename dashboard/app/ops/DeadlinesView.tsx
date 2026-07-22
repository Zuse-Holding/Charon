"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./DeadlinesView.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { DeadlineRow } from "@/lib/supabase/types";
import { formatDate, daysUntilDate } from "@/lib/format";

// Compliance clock (SELENE_OS_SPEC.md §3.4) — pure date math, no LLM in this
// path. The Formation canvas node only ever shows the single nearest
// deadline; this is the full list with the 30/7-day coloring the spec calls
// for ("inside 30 days surfaced, inside 7 days it goes red").

function toneFor(days: number): "bad" | "warn" | "ok" {
  if (days <= 7) return "bad";
  if (days <= 30) return "warn";
  return "ok";
}

export default function DeadlinesView() {
  const [open, setOpen] = useState<DeadlineRow[]>([]);
  const [done, setDone] = useState<DeadlineRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);
  function supabase(): SupabaseBrowserClient {
    return supabaseRef.current ?? (supabaseRef.current = createClient());
  }

  async function loadAll() {
    const db = supabase();
    const [openRes, doneRes] = await Promise.all([
      db.from("deadlines").select("*").eq("status", "open").order("due_date", { ascending: true }),
      db.from("deadlines").select("*").neq("status", "open").order("due_date", { ascending: false }).limit(10),
    ]);
    setOpen((openRes.data as DeadlineRow[] | null) ?? []);
    setDone((doneRes.data as DeadlineRow[] | null) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markDone(row: DeadlineRow) {
    setOpen((prev) => prev.filter((r) => r.id !== row.id));
    const { error } = await supabase()
      .from("deadlines")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      setOpen((prev) => [...prev, row].sort((a, b) => a.due_date.localeCompare(b.due_date)));
      return;
    }
    setDone((prev) => [{ ...row, status: "done" }, ...prev]);
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Compliance clock</div>
        <div className={styles.count}>{open.length} open</div>
      </div>

      {loaded && open.length === 0 && <div className={styles.empty}>Nothing on the clock.</div>}

      {open.map((row) => {
        const days = daysUntilDate(row.due_date);
        const tone = toneFor(days);
        return (
          <div key={row.id} className={`${styles.row} ${styles[tone]}`}>
            <div className={styles.days}>{days < 0 ? `${Math.abs(days)}d over` : `${days}d`}</div>
            <div className={styles.body}>
              <div className={styles.rowTitle}>{row.title}</div>
              <div className={styles.rowMeta}>
                <span className={styles.kindTag}>{row.kind}</span>
                <span className={`${styles.date} mono`}>{formatDate(row.due_date)}</span>
                {row.recurrence && row.recurrence !== "none" && <span>{row.recurrence}</span>}
              </div>
              {row.notes && <div className={styles.notes}>{row.notes}</div>}
            </div>
            <button className={styles.doneBtn} onClick={() => markDone(row)}>Mark done</button>
          </div>
        );
      })}

      {done.length > 0 && (
        <div className={styles.doneSection}>
          <div className={styles.title}>Recently resolved</div>
          {done.map((row) => (
            <div key={row.id} className={styles.doneRow}>
              <span>{row.title} — {row.status}</span>
              <span className={`${styles.date} mono`}>{formatDate(row.due_date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
