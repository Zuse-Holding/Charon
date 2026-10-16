"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./OpsViews.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { SeleneFactRow } from "@/lib/supabase/types";
import { formatDate } from "@/lib/format";

// Memory — what Selene knows (selene_facts). The brief and future runs read
// active facts, so this is where Nick checks and corrects her. Wrong facts
// get switched off, not deleted, so there's a record of what she believed.

const SOURCE_LABEL: Record<string, string> = {
  agent: "Selene noted",
  nick: "You told her",
  conversation: "From chat",
  migration: "Imported",
};

async function postFacts(body: Record<string, unknown>): Promise<{ row?: SeleneFactRow; error?: string }> {
  try {
    const res = await fetch("/api/ops/facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { row: data.row } : { error: data.error ?? "That didn't save." };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export default function MemoryView() {
  const [facts, setFacts] = useState<SeleneFactRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);

  useEffect(() => {
    const db = supabaseRef.current ?? (supabaseRef.current = createClient());
    db.from("selene_facts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setFacts((data as SeleneFactRow[] | null) ?? []);
        setLoaded(true);
      });
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    const { row, error: err } = await postFacts({ action: "add", fact: draft });
    setSaving(false);
    if (err || !row) {
      setError(err ?? "That didn't save.");
      return;
    }
    setFacts((prev) => [row, ...prev]);
    setDraft("");
  }

  async function toggle(fact: SeleneFactRow) {
    setError(null);
    setFacts((prev) => prev.map((f) => (f.id === fact.id ? { ...f, active: !f.active } : f)));
    const { error: err } = await postFacts({ action: "set_active", id: fact.id, active: !fact.active });
    if (err) {
      setFacts((prev) => prev.map((f) => (f.id === fact.id ? fact : f)));
      setError(err);
    }
  }

  const active = facts.filter((f) => f.active);
  const off = facts.filter((f) => !f.active);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>What Selene knows</div>
        <div className={styles.count}>{active.length} active</div>
      </div>

      <form className={styles.form} onSubmit={add}>
        <div className={`${styles.field} ${styles.wide}`}>
          <label htmlFor="fact">Tell her something worth remembering</label>
          <input
            id="fact"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Vendor invoices get paid within 3 days of arriving"
            maxLength={500}
          />
        </div>
        <div className={styles.formActions}>
          <button type="submit" className={styles.btnPrimary} disabled={saving || !draft.trim()}>
            {saving ? "Saving…" : "Remember this"}
          </button>
        </div>
      </form>

      {error && <div className={styles.error}>{error}</div>}

      {loaded && active.length === 0 && (
        <div className={styles.empty}>Nothing yet. Facts land here as she learns them, or when you add one.</div>
      )}

      {active.map((f) => (
        <div key={f.id} className={`${styles.row} ${styles.edgeSelene}`}>
          <div className={styles.rowBody}>
            <div className={styles.rowTitle}>{f.fact}</div>
            <div className={styles.rowMeta}>
              <span>{SOURCE_LABEL[f.source] ?? f.source}</span>
              <span className={styles.mono}>{formatDate(f.created_at)}</span>
            </div>
          </div>
          <button className={`${styles.btn} ${styles.danger}`} onClick={() => toggle(f)}>Forget this</button>
        </div>
      ))}

      {off.length > 0 && (
        <>
          <button className={styles.btn} style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => setShowOff((v) => !v)}>
            {showOff ? "Hide" : "Show"} {off.length} forgotten
          </button>
          {showOff && off.map((f) => (
            <div key={f.id} className={`${styles.row} ${styles.dim}`}>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>{f.fact}</div>
                <div className={styles.rowMeta}><span>{SOURCE_LABEL[f.source] ?? f.source}</span></div>
              </div>
              <button className={styles.btn} onClick={() => toggle(f)}>Bring back</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
