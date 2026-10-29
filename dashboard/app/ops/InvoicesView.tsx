"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./OpsViews.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { ApprovalQueueRow, InvoiceRow, LeadRow } from "@/lib/supabase/types";
import { daysUntilDate, formatDate, formatMoney } from "@/lib/format";

// Invoices — billed through Stripe. Drafting one here only queues it
// (/api/ops/invoices → approval_queue); approving it in the queue is what
// sends it (agents/executor.py). Paid/void status comes back from Stripe
// every 15 minutes via agents/invoices.py, which also logs the payment to
// the ledger and closes a linked lead.

const PRODUCT_LABEL: Record<string, string> = {
  intelligence: "Metis Intelligence", diligence: "Metis Diligence", committee: "Committee",
};

interface LineDraft { description: string; amount: string; quantity: string }
const EMPTY_LINE: LineDraft = { description: "", amount: "", quantity: "1" };

function lineTotal(lines: LineDraft[]): number {
  return lines.reduce((sum, l) => sum + (Number(l.amount) || 0) * (Number(l.quantity) || 0), 0);
}

export default function InvoicesView({ onOpenQueue }: { onOpenQueue: () => void }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [pending, setPending] = useState<ApprovalQueueRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ lead_id: "", customer_email: "", customer_name: "", product: "intelligence", days_until_due: "30", memo: "" });
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);

  useEffect(() => {
    const db = supabaseRef.current ?? (supabaseRef.current = createClient());
    Promise.all([
      db.from("invoices").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("approval_queue").select("*").eq("action_type", "send_invoice").in("status", ["pending", "approved", "executing"])
        .order("created_at", { ascending: false }),
      db.from("leads").select("*").in("status", ["enriched", "contacted", "replied", "qualified"]).order("created_at", { ascending: false }),
    ]).then(([invRes, queueRes, leadRes]) => {
      if (invRes.error) setError("Couldn't load invoices. Has migrations/004_invoices.sql been run?");
      setInvoices((invRes.data as InvoiceRow[] | null) ?? []);
      setPending((queueRes.data as ApprovalQueueRow[] | null) ?? []);
      setLeads((leadRes.data as LeadRow[] | null) ?? []);
      setLoaded(true);
    });
  }, []);

  function setLine(i: number, key: keyof LineDraft, value: string) {
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, [key]: value } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, items: lines }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That didn't save.");
        return;
      }
      setPending((prev) => [data.row, ...prev]);
      setDrafting(false);
      setLines([{ ...EMPTY_LINE }]);
      setForm((f) => ({ ...f, lead_id: "", customer_email: "", customer_name: "", memo: "" }));
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const open = invoices.filter((i) => i.status === "open");
  const overdue = open.filter((i) => i.due_date && daysUntilDate(i.due_date) < 0);
  const since30 = Date.now() - 30 * 86_400_000;
  const paid = invoices.filter((i) => i.status === "paid");
  const paid30 = paid.filter((i) => i.paid_at && new Date(i.paid_at).getTime() >= since30);
  const closed = invoices.filter((i) => i.status === "void" || i.status === "uncollectible");
  const sum = (rows: InvoiceRow[], k: "amount_due" | "amount_paid") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const lead = leads.find((l) => l.id === form.lead_id);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Invoices</div>
        {!drafting && <button className={styles.btnPrimary} onClick={() => setDrafting(true)}>Draft an invoice</button>}
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Outstanding</div>
          <div className={styles.tileValue}>{formatMoney(sum(open, "amount_due"))}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Overdue</div>
          <div className={`${styles.tileValue} ${overdue.length ? styles.bad : ""}`}>{formatMoney(sum(overdue, "amount_due"))}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Collected, last 30 days</div>
          <div className={`${styles.tileValue} ${paid30.length ? styles.good : ""}`}>{formatMoney(sum(paid30, "amount_paid"))}</div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {drafting && (
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}>
            <label>Lead (optional)</label>
            <select value={form.lead_id} onChange={(e) => setForm({ ...form, lead_id: e.target.value })}>
              <option value="">Not from a lead</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name || l.email} {l.company ? `· ${l.company}` : ""}</option>)}
            </select>
          </div>
          {lead ? (
            <div className={styles.field}><label>Bills</label><input value={lead.email ?? "no email on file"} disabled /></div>
          ) : (
            <div className={styles.field}>
              <label>Customer email</label>
              <input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} required />
            </div>
          )}
          <div className={styles.field}>
            <label>Name on invoice</label>
            <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder={lead?.name ?? "Company or person"} />
          </div>
          <div className={styles.field}>
            <label>Product</label>
            <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
              {Object.entries(PRODUCT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label>Due in (days)</label>
            <input type="number" min={1} max={90} value={form.days_until_due} onChange={(e) => setForm({ ...form, days_until_due: e.target.value })} />
          </div>

          {lines.map((l, i) => (
            <div key={i} className={`${styles.field} ${styles.wide}`} style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px auto", gap: 8, alignItems: "end" }}>
              <div className={styles.field}>
                {i === 0 && <label>What it&apos;s for</label>}
                <input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder="e.g. Diligence report, Q4" required />
              </div>
              <div className={styles.field}>
                {i === 0 && <label>Price (USD)</label>}
                <input type="number" min={0.01} step="0.01" value={l.amount} onChange={(e) => setLine(i, "amount", e.target.value)} required />
              </div>
              <div className={styles.field}>
                {i === 0 && <label>Qty</label>}
                <input type="number" min={1} max={1000} value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              </div>
              <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((_, n) => n !== i))}>Remove</button>
            </div>
          ))}
          <div className={styles.formActions}>
            <button type="button" className={styles.btn} onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}>Add a line</button>
            <span className={`${styles.mono}`} style={{ marginLeft: "auto", fontSize: 13 }}>Total {formatMoney(lineTotal(lines))}</span>
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <label>Note on the invoice (optional)</label>
            <input value={form.memo} maxLength={500} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>{saving ? "Queuing…" : "Queue for approval"}</button>
            <button type="button" className={styles.btn} onClick={() => setDrafting(false)}>Cancel</button>
            <span className={styles.hint}>Nothing goes to the customer until you approve it in the queue.</span>
          </div>
        </form>
      )}

      {pending.length > 0 && <div className={styles.subTitle}>Waiting on you</div>}
      {pending.map((q) => (
        <div key={q.id} className={`${styles.row} ${q.status === "pending" ? styles.edgeWarn : styles.edgeSelene}`}>
          <div className={styles.rowBody}>
            <div className={styles.rowTitle}>{q.summary}</div>
            <div className={styles.rowMeta}>{q.status === "pending" ? "needs your approval" : "approved, going out shortly"}</div>
          </div>
          {q.status === "pending" && <button className={styles.btn} onClick={onOpenQueue}>Review in queue</button>}
        </div>
      ))}

      {loaded && invoices.length === 0 && pending.length === 0 && !drafting && (
        <div className={styles.empty}>No invoices yet. Draft one and it goes to the queue for your OK before Stripe sends it.</div>
      )}

      {open.length > 0 && <div className={styles.subTitle}>Open</div>}
      {open.map((inv) => {
        const days = inv.due_date ? daysUntilDate(inv.due_date) : null;
        return (
          <div key={inv.id} className={`${styles.row} ${days != null && days < 0 ? styles.edgeBad : days != null && days <= 7 ? styles.edgeWarn : styles.edgeSelene}`}>
            <div className={styles.rowBody}>
              <div className={styles.rowTitle}>{inv.customer_name || inv.customer_email}</div>
              <div className={styles.rowMeta}>
                <span className={styles.mono}>{inv.number ?? inv.stripe_invoice_id}</span>
                {inv.product && <span>{PRODUCT_LABEL[inv.product]}</span>}
                <span className={styles.mono}>{formatMoney(Number(inv.amount_due))}</span>
                {inv.due_date && (
                  <span className={`${styles.mono} ${days! < 0 ? styles.bad : days! <= 7 ? styles.warn : ""}`}>
                    {days! < 0 ? `${Math.abs(days!)}d overdue` : `due ${formatDate(inv.due_date)}`}
                  </span>
                )}
              </div>
            </div>
            {inv.hosted_url && <a className={styles.btn} href={inv.hosted_url} target="_blank" rel="noreferrer">View invoice</a>}
          </div>
        );
      })}

      {paid.length > 0 && <div className={styles.subTitle}>Paid</div>}
      {paid.slice(0, 15).map((inv) => (
        <div key={inv.id} className={`${styles.row} ${styles.edgeOk}`}>
          <div className={styles.rowBody}>
            <div className={styles.rowTitle}>{inv.customer_name || inv.customer_email}</div>
            <div className={styles.rowMeta}>
              <span className={styles.mono}>{inv.number ?? inv.stripe_invoice_id}</span>
              {inv.product && <span>{PRODUCT_LABEL[inv.product]}</span>}
              <span className={`${styles.mono} ${styles.good}`}>{formatMoney(Number(inv.amount_paid))}</span>
              {inv.paid_at && <span className={styles.mono}>paid {formatDate(inv.paid_at)}</span>}
            </div>
          </div>
        </div>
      ))}

      {closed.length > 0 && <div className={styles.subTitle}>Voided or written off</div>}
      {closed.map((inv) => (
        <div key={inv.id} className={`${styles.row} ${styles.dim}`}>
          <div className={styles.rowBody}>
            <div className={styles.rowTitle}>{inv.customer_name || inv.customer_email}</div>
            <div className={styles.rowMeta}>
              <span className={styles.mono}>{inv.number ?? inv.stripe_invoice_id}</span>
              <span className={styles.mono}>{formatMoney(Number(inv.amount_due))}</span>
              <span>{inv.status}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
