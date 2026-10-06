"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ApprovalQueue.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import { subscribeToApprovalQueue } from "../../lib/realtime";
import { formatMoney } from "@/lib/format";
import type { ApprovalQueueRow, ApprovalStatus } from "@/lib/supabase/types";

// The heart of the system (SELENE_OS_SPEC.md §5). Every irreversible action
// Selene wants to take lands here as a pending row — she never gets a tool
// that sends email, spends money, or contacts anyone directly
// (CLAUDE.md non-negotiable #1). Approving hands the row to
// agents/executor.py, which carries it out about 20s later — after the
// 10s undo window has closed. Approve/reject/undo go through
// /api/ops/queue (server-side, behind the login), not the anon key.

const ACTION_LABELS: Record<string, { approve: string; reject: string }> = {
  send_email: { approve: "Send reply", reject: "Discard draft" },
  add_ledger_entry: { approve: "Add to ledger", reject: "Discard entry" },
  contact_lead: { approve: "Send first touch", reject: "Skip" },
  update_lead_status: { approve: "Move lead", reject: "Skip" },
  send_invoice: { approve: "Send invoice", reject: "Discard invoice" },
};

const PRODUCT_LABEL: Record<string, string> = {
  intelligence: "Metis Intelligence", diligence: "Metis Diligence", committee: "Committee",
};

const STATUS_LABEL: Partial<Record<ApprovalStatus, string>> = {
  approved: "Going out shortly",
  executing: "Going out now",
  executed: "Done",
  failed: "Didn't go through",
  rejected: "Discarded",
};

function labelsFor(actionType: string) {
  return ACTION_LABELS[actionType] ?? { approve: "Approve", reject: "Reject" };
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return Array.isArray(v) ? v.join(", ") : JSON.stringify(v);
}

// Show Nick exactly what will happen — the whole draft, not a preview. He
// can't approve what he can't read.
function ActionDetail({ row }: { row: ApprovalQueueRow }) {
  const p = row.payload ?? {};
  if (row.action_type === "send_email" || row.action_type === "contact_lead") {
    return (
      <div className={styles.payload}>
        <div className={styles.payloadRow}>
          <span className={styles.payloadKey}>To</span>
          <span className={styles.payloadVal}>
            {row.action_type === "contact_lead" ? "the lead's email on file" : str(p.to)}
          </span>
        </div>
        <div className={styles.payloadRow}>
          <span className={styles.payloadKey}>Subject</span>
          <span className={styles.payloadVal}>{str(p.subject)}</span>
        </div>
        <div className={styles.emailBody}>{str(p.body)}</div>
      </div>
    );
  }
  if (row.action_type === "send_invoice") {
    const items = Array.isArray(p.items) ? (p.items as { description?: unknown; amount?: unknown; quantity?: unknown }[]) : [];
    const total = items.reduce((sum, it) => sum + (Number(it.amount) || 0) * (Number(it.quantity ?? 1) || 0), 0);
    return (
      <div className={styles.payload}>
        <div className={styles.payloadRow}>
          <span className={styles.payloadKey}>Bill to</span>
          <span className={styles.payloadVal}>
            {row.related_lead ? "the lead's email on file" : str(p.customer_email)}{p.customer_name ? ` · ${str(p.customer_name)}` : ""}
          </span>
        </div>
        <div className={styles.payloadRow}>
          <span className={styles.payloadKey}>Product</span>
          <span className={styles.payloadVal}>{PRODUCT_LABEL[str(p.product)] ?? str(p.product)}</span>
        </div>
        {items.map((it, i) => (
          <div key={i} className={styles.payloadRow}>
            <span className={styles.payloadKey}>{Number(it.quantity ?? 1) > 1 ? `${str(it.quantity)} ×` : "Line"}</span>
            <span className={styles.payloadVal}>{str(it.description)} · {formatMoney(Number(it.amount) || 0)}</span>
          </div>
        ))}
        <div className={styles.payloadRow}>
          <span className={styles.payloadKey}>Total</span>
          <span className={styles.payloadVal}>{formatMoney(total)} · due in {str(p.days_until_due ?? 30)} days</span>
        </div>
        {p.memo ? <div className={styles.emailBody}>{str(p.memo)}</div> : null}
      </div>
    );
  }
  if (row.action_type === "add_ledger_entry") {
    const amount = Number(p.amount);
    return (
      <div className={styles.payload}>
        {[
          ["Vendor", str(p.vendor)],
          ["Amount", Number.isFinite(amount) ? `${p.direction === "in" ? "+" : "−"}${formatMoney(amount)}` : str(p.amount)],
          ["Date", str(p.entry_date) || "today"],
          ["Category", str(p.category)],
          ["Venture", str(p.venture).replace("_", " ")],
          ["Deductible", p.deductible === false ? "no" : `yes · ${str(p.business_use_pct ?? 100)}% business`],
          ...(p.description ? [["Note", str(p.description)]] : []),
        ].map(([k, v]) => (
          <div key={k} className={styles.payloadRow}>
            <span className={styles.payloadKey}>{k}</span>
            <span className={styles.payloadVal}>{v}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.payload}>
      {Object.entries(p).map(([k, v]) => (
        <div key={k} className={styles.payloadRow}>
          <span className={styles.payloadKey}>{k}</span>
          <span className={styles.payloadVal}>{str(v)}</span>
        </div>
      ))}
    </div>
  );
}

const UNDO_WINDOW_MS = 10_000;
const HISTORY_LIMIT = 8;

interface Toast {
  id: number;
  row: ApprovalQueueRow;
  newStatus: ApprovalStatus;
  label: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

let toastIdSeq = 1;

async function postQueue(id: string, action: "approve" | "reject" | "undo"): Promise<string | null> {
  try {
    const res = await fetch("/api/ops/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? "That didn't save. Try again.";
  } catch {
    return "Couldn't reach the server. Try again.";
  }
}

export default function ApprovalQueue() {
  const [rows, setRows] = useState<ApprovalQueueRow[]>([]);
  const [history, setHistory] = useState<ApprovalQueueRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Created lazily (client-only) so this component never touches Supabase
  // during SSR/build, when env vars may not be present.
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);
  function supabase(): SupabaseBrowserClient {
    return supabaseRef.current ?? (supabaseRef.current = createClient());
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      supabase().from("approval_queue").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase().from("approval_queue").select("*").neq("status", "pending")
        .order("resolved_at", { ascending: false, nullsFirst: false }).limit(HISTORY_LIMIT),
    ]).then(([pendingRes, historyRes]) => {
      if (cancelled) return;
      setRows((pendingRes.data as ApprovalQueueRow[] | null) ?? []);
      setHistory((historyRes.data as ApprovalQueueRow[] | null) ?? []);
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
        setHistory((prev) => {
          const rest = prev.filter((r) => r.id !== row.id);
          return row.status === "pending" ? rest : [row, ...rest].slice(0, HISTORY_LIMIT);
        });
      },
    });
  }, []);

  async function resolve(row: ApprovalQueueRow, newStatus: "approved" | "rejected") {
    setNotice(null);
    setRows((prev) => prev.filter((r) => r.id !== row.id));

    const err = await postQueue(row.id, newStatus === "approved" ? "approve" : "reject");
    if (err) {
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
      setNotice(err);
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

    const err = await postQueue(toast.row.id, "undo");
    if (err) {
      setNotice(err);
      return;
    }
    setRows((prev) => (prev.some((r) => r.id === toast.row.id) ? prev : [toast.row, ...prev]));
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Approval queue</div>
        <div className={`${styles.count} mono`}>{rows.length} pending</div>
      </div>

      {notice && <div className={styles.notice}>{notice}</div>}

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
              <span className={styles.module}>{row.module} · {row.action_type.replace(/_/g, " ")}</span>
              <span className={`${styles.ts} mono`}>{fmtTs(row.created_at)}</span>
            </div>
            <div className={styles.summary}>{row.summary}</div>
            <ActionDetail row={row} />
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

      {loaded && rows.length > 0 && (
        <div className={styles.hint}>
          Approving sends it about 20 seconds later. You get 10 seconds to undo. Once it&apos;s gone out, there&apos;s no undo.
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className={styles.historyTitle}>Recently handled</div>
          {history.map((row) => (
            <div key={row.id} className={`${styles.historyRow} ${styles[`h_${row.status}`] ?? ""}`}>
              <div className={styles.historyMain}>
                <span className={styles.historySummary}>{row.summary}</span>
                <span className={styles.historyStatus}>{STATUS_LABEL[row.status] ?? row.status}</span>
              </div>
              {(row.error || row.result) && (
                <div className={styles.historyDetail}>{row.error ?? row.result}</div>
              )}
              <div className={`${styles.ts} mono`}>{fmtTs(row.executed_at ?? row.resolved_at ?? row.created_at)}</div>
            </div>
          ))}
        </>
      )}

      {toasts.length > 0 && (
        <div className={styles.toasts}>
          {toasts.map((toast) => (
            <div key={toast.id} className={styles.toast}>
              <span className={styles.toastLabel}>
                {toast.newStatus === "approved" ? "Approved" : "Discarded"} — {toast.label}
              </span>
              <span className={styles.undo} onClick={() => undo(toast)}>Undo</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
