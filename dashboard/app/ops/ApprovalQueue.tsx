"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ApprovalQueue.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import { subscribeToApprovalQueue } from "../../lib/realtime";
import type { ApprovalQueueRow, ApprovalStatus } from "@/lib/supabase/types";

// The heart of the system (SELENE_OS_SPEC.md §5). Every irreversible action
// Selene wants to take lands here as a pending row — she never gets a tool
// that sends email, spends money, or contacts anyone directly
// (CLAUDE.md non-negotiable #1). This is Nick's only consequence path.

const ACTION_LABELS: Record<string, { approve: string; reject: string }> = {
  send_email: { approve: "Send reply", reject: "Discard draft" },
  add_ledger_entry: { approve: "Add to ledger", reject: "Discard entry" },
  contact_lead: { approve: "Reach out", reject: "Skip" },
  update_lead_status: { approve: "Apply", reject: "Skip" },
};

function labelsFor(actionType: string) {
  return ACTION_LABELS[actionType] ?? { approve: "Approve", reject: "Reject" };
}

function fmtTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function payloadPreview(payload: Record<string, unknown>): { key: string; val: string }[] {
  return Object.entries(payload)
    .slice(0, 4)
    .map(([key, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      return { key, val: val.length > 60 ? val.slice(0, 57) + "…" : val };
    });
}

const UNDO_WINDOW_MS = 10_000;

interface Toast {
  id: number;
  row: ApprovalQueueRow;
  newStatus: ApprovalStatus;
  label: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

let toastIdSeq = 1;

export default function ApprovalQueue() {
  const [rows, setRows] = useState<ApprovalQueueRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Created lazily (client-only) so this component never touches Supabase
  // during SSR/build, when env vars may not be present.
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);
  function supabase(): SupabaseBrowserClient {
    return supabaseRef.current ?? (supabaseRef.current = createClient());
  }

  useEffect(() => {
    let cancelled = false;

    supabase()
      .from("approval_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data as ApprovalQueueRow[] | null) ?? []);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeToApprovalQueue({
      onInsert: (row) => {
        if (row.status === "pending") {
          setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
        }
      },
      onUpdate: (row) => {
        setRows((prev) => {
          if (row.status === "pending") {
            return prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev];
          }
          return prev.filter((r) => r.id !== row.id);
        });
      },
    });
  }, []);

  async function resolve(row: ApprovalQueueRow, newStatus: "approved" | "rejected") {
    setRows((prev) => prev.filter((r) => r.id !== row.id));

    const { error } = await supabase()
      .from("approval_queue")
      .update({ status: newStatus, resolved_at: new Date().toISOString() })
      .eq("id", row.id);

    if (error) {
      // Put it back — the write didn't take.
      setRows((prev) => [row, ...prev]);
      return;
    }

    const label = labelsFor(row.action_type)[newStatus === "approved" ? "approve" : "reject"];
    const id = toastIdSeq++;
    const timeoutId = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, UNDO_WINDOW_MS);
    setToasts((prev) => [...prev, { id, row, newStatus, label, timeoutId }]);
  }

  async function undo(toast: Toast) {
    clearTimeout(toast.timeoutId);
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));

    const { error } = await supabase()
      .from("approval_queue")
      .update({ status: "pending", resolved_at: null })
      .eq("id", toast.row.id);

    if (!error) {
      setRows((prev) => (prev.some((r) => r.id === toast.row.id) ? prev : [toast.row, ...prev]));
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Approval queue</div>
        <div className={`${styles.count} mono`}>{rows.length} pending</div>
      </div>

      {loaded && rows.length === 0 && (
        <div className={styles.empty}>
          <div>Nothing needs you.</div>
          <div>I&apos;ll flag it when something does.</div>
        </div>
      )}

      {rows.map((row) => {
        const labels = labelsFor(row.action_type);
        return (
          <div key={row.id} className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.module}>{row.module} · {row.action_type}</span>
              <span className={`${styles.ts} mono`}>{fmtTs(row.created_at)}</span>
            </div>
            <div className={styles.summary}>{row.summary}</div>
            {Object.keys(row.payload ?? {}).length > 0 && (
              <div className={styles.payload}>
                {payloadPreview(row.payload).map(({ key, val }) => (
                  <div key={key} className={styles.payloadRow}>
                    <span className={styles.payloadKey}>{key}</span>
                    <span className={styles.payloadVal}>{val}</span>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.actions}>
              <button className={`${styles.btn} ${styles.approve}`} onClick={() => resolve(row, "approved")}>
                {labels.approve}
              </button>
              <button className={`${styles.btn} ${styles.reject}`} onClick={() => resolve(row, "rejected")}>
                {labels.reject}
              </button>
            </div>
          </div>
        );
      })}

      {toasts.length > 0 && (
        <div className={styles.toasts}>
          {toasts.map((toast) => (
            <div key={toast.id} className={styles.toast}>
              <span className={styles.toastLabel}>
                {toast.newStatus === "approved" ? "Approved" : "Rejected"} — {toast.label}
              </span>
              <span className={styles.undo} onClick={() => undo(toast)}>Undo</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
