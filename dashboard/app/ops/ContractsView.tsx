"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./OpsViews.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { ContractRow, ContractStatus } from "@/lib/supabase/types";
import { daysUntilDate, formatDate, formatMoney } from "@/lib/format";

// Contracts — NDAs, customer, vendor and partner agreements. Signed ones
// put their end date and notice deadline on the compliance clock via a DB
// trigger (schema.sql sync_contract_deadlines), so they show up in the
// Deadlines tab and the brief without anyone re-typing dates.

const KIND_LABEL: Record<string, string> = {
  nda: "NDA", customer: "Customer", vendor: "Vendor", partner: "Partner", contractor: "Contractor", other: "Other",
};
const PRODUCT_LABEL: Record<string, string> = {
  intelligence: "Metis Intelligence", diligence: "Metis Diligence", committee: "Committee",
};
const VENTURES = ["zuse", "metis", "charon", "lounge", "kairos", "trading", "personal_mixed"];

type Draft = Partial<Record<keyof ContractRow, string | boolean | number | null>>;

const EMPTY: Draft = {
  title: "", counterparty: "", kind: "nda", venture: "zuse", product: "", status: "draft",
  sent_on: "", signed_on: "", ends_on: "", auto_renews: false, renewal_months: "", notice_days: "",
  value_usd: "", billing: "", doc_url: "", notes: "",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayTone(days: number): string {
  return days <= 7 ? styles.bad : days <= 30 ? styles.warn : "";
}

function daysLabel(days: number): string {
  return days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? "today" : `in ${days}d`;
}

async function save(contract: Draft): Promise<{ row?: ContractRow; error?: string }> {
  try {
    const res = await fetch("/api/ops/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { row: data.row } : { error: data.error ?? "That didn't save." };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export default function ContractsView() {
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);

  useEffect(() => {
    const db = supabaseRef.current ?? (supabaseRef.current = createClient());
    db.from("contracts")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError("Couldn't load contracts. Has migrations/003_contracts.sql been run?");
        setRows((data as ContractRow[] | null) ?? []);
        setLoaded(true);
      });
  }, []);

  function upsertLocal(row: ContractRow) {
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    const { row, error: err } = await save(editing);
    setSaving(false);
    if (err || !row) {
      setError(err ?? "That didn't save.");
      return;
    }
    upsertLocal(row);
    setEditing(null);
  }

  async function move(row: ContractRow, status: ContractStatus) {
    setError(null);
    const patch: Draft = { ...row, status };
    if (status === "sent" && !row.sent_on) patch.sent_on = today();
    if (status === "signed" && !row.signed_on) patch.signed_on = today();
    const { row: saved, error: err } = await save(patch);
    if (err || !saved) {
      setError(err ?? "That didn't save.");
      return;
    }
    upsertLocal(saved);
  }

  function field<K extends keyof ContractRow>(key: K) {
    return {
      value: (editing?.[key] as string | number | null | undefined) ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setEditing((d) => ({ ...d, [key]: e.target.value })),
    };
  }

  const waiting = rows.filter((r) => r.status === "draft" || r.status === "sent");
  const active = rows
    .filter((r) => r.status === "signed")
    .sort((a, b) => (a.ends_on ?? "9999").localeCompare(b.ends_on ?? "9999"));
  const closed = rows.filter((r) => r.status === "expired" || r.status === "terminated");

  function meta(r: ContractRow) {
    return (
      <>
        <span className={styles.tag}>{KIND_LABEL[r.kind] ?? r.kind}</span>
        <span>{r.counterparty}</span>
        <span>{r.product ? PRODUCT_LABEL[r.product] : r.venture.replace("_", " ")}</span>
        {r.value_usd != null && (
          <span className={styles.mono}>
            {formatMoney(Number(r.value_usd))}{r.billing === "monthly" ? "/mo" : r.billing === "annual" ? "/yr" : ""}
          </span>
        )}
        {r.doc_url && <a href={r.doc_url} target="_blank" rel="noreferrer">Open doc</a>}
      </>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Contracts</div>
        {!editing && (
          <button className={styles.btnPrimary} onClick={() => setEditing({ ...EMPTY })}>Add a contract</button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {editing && (
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.field}><label>Title</label><input {...field("title")} placeholder="Oak Tree NDA" required /></div>
          <div className={styles.field}><label>With</label><input {...field("counterparty")} placeholder="Company or person" required /></div>
          <div className={styles.field}>
            <label>Kind</label>
            <select {...field("kind")}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className={styles.field}>
            <label>Venture</label>
            <select {...field("venture")}>{VENTURES.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}</select>
          </div>
          {editing.venture === "metis" && (
            <div className={styles.field}>
              <label>Product</label>
              <select {...field("product")}>
                <option value="">All of Metis</option>
                {Object.entries(PRODUCT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}
          <div className={styles.field}>
            <label>Status</label>
            <select {...field("status")}>
              {["draft", "sent", "signed", "expired", "terminated"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className={styles.field}><label>Sent</label><input type="date" {...field("sent_on")} /></div>
          <div className={styles.field}><label>Signed</label><input type="date" {...field("signed_on")} /></div>
          <div className={styles.field}><label>Ends / renews</label><input type="date" {...field("ends_on")} /></div>
          <div className={styles.field}><label>Notice needed (days)</label><input type="number" min={0} max={365} {...field("notice_days")} /></div>
          <div className={styles.field}>
            <label>Auto-renews</label>
            <select
              value={editing.auto_renews ? "yes" : "no"}
              onChange={(e) => setEditing((d) => ({ ...d, auto_renews: e.target.value === "yes" }))}
            >
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </div>
          {editing.auto_renews && (
            <div className={styles.field}><label>Renewal term (months)</label><input type="number" min={1} max={120} {...field("renewal_months")} /></div>
          )}
          <div className={styles.field}><label>Value (USD)</label><input type="number" min={0} step="0.01" {...field("value_usd")} /></div>
          <div className={styles.field}>
            <label>Billing</label>
            <select {...field("billing")}>
              <option value="">—</option><option value="one_time">One time</option>
              <option value="monthly">Monthly</option><option value="annual">Annual</option>
            </select>
          </div>
          <div className={`${styles.field} ${styles.wide}`}><label>Document link</label><input type="url" {...field("doc_url")} placeholder="https://" /></div>
          <div className={`${styles.field} ${styles.wide}`}><label>Notes</label><textarea rows={2} {...field("notes")} /></div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save contract"}</button>
            <button type="button" className={styles.btn} onClick={() => setEditing(null)}>Cancel</button>
            <span className={styles.hint}>Signed contracts with an end date go on the compliance clock automatically.</span>
          </div>
        </form>
      )}

      {loaded && rows.length === 0 && !editing && (
        <div className={styles.empty}>No contracts yet. The Oak Tree NDA is a good first one.</div>
      )}

      {waiting.length > 0 && <div className={styles.subTitle}>Waiting on signature</div>}
      {waiting.map((r) => {
        const since = r.sent_on ?? r.created_at.slice(0, 10);
        const age = -daysUntilDate(since);
        return (
          <div key={r.id} className={`${styles.row} ${age > 14 ? styles.edgeWarn : styles.edgeSelene}`}>
            <div className={styles.rowBody}>
              <div className={styles.rowTitle}>{r.title}</div>
              <div className={styles.rowMeta}>
                {meta(r)}
                <span className={`${styles.mono} ${age > 14 ? styles.warn : ""}`}>
                  {r.status === "sent" ? `sent ${age}d ago` : `draft for ${age}d`}
                </span>
              </div>
            </div>
            {r.status === "draft" && <button className={styles.btn} onClick={() => move(r, "sent")}>Mark sent</button>}
            <button className={styles.btn} onClick={() => move(r, "signed")}>Mark signed</button>
            <button className={styles.btn} onClick={() => setEditing({ ...r })}>Edit</button>
          </div>
        );
      })}

      {active.length > 0 && <div className={styles.subTitle}>Active</div>}
      {active.map((r) => {
        const endDays = r.ends_on ? daysUntilDate(r.ends_on) : null;
        const noticeDays = r.ends_on && r.notice_days ? endDays! - r.notice_days : null;
        const soonest = Math.min(endDays ?? Infinity, noticeDays ?? Infinity);
        return (
          <div key={r.id} className={`${styles.row} ${soonest <= 7 ? styles.edgeBad : soonest <= 30 ? styles.edgeWarn : styles.edgeOk}`}>
            <div className={styles.rowBody}>
              <div className={styles.rowTitle}>{r.title}</div>
              <div className={styles.rowMeta}>
                {meta(r)}
                {r.ends_on ? (
                  <span className={`${styles.mono} ${dayTone(endDays!)}`}>
                    {r.auto_renews ? "renews" : "ends"} {formatDate(r.ends_on)} ({daysLabel(endDays!)})
                  </span>
                ) : (
                  <span>no end date</span>
                )}
                {noticeDays != null && (
                  <span className={`${styles.mono} ${dayTone(noticeDays)}`}>notice by {daysLabel(noticeDays)}</span>
                )}
              </div>
              {r.notes && <div className={styles.hint} style={{ marginTop: 4 }}>{r.notes}</div>}
            </div>
            <button className={styles.btn} onClick={() => setEditing({ ...r })}>Edit</button>
            <button className={`${styles.btn} ${styles.danger}`} onClick={() => move(r, "terminated")}>End it</button>
          </div>
        );
      })}

      {closed.length > 0 && (
        <>
          <button className={styles.btn} style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide" : "Show"} {closed.length} closed
          </button>
          {showClosed && closed.map((r) => (
            <div key={r.id} className={`${styles.row} ${styles.dim}`}>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>{r.title}</div>
                <div className={styles.rowMeta}>{meta(r)}<span>{r.status}</span></div>
              </div>
              <button className={styles.btn} onClick={() => setEditing({ ...r })}>Edit</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
