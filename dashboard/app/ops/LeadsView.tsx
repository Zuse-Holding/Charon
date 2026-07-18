"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LeadsView.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import { subscribeToLeads } from "../../lib/realtime";
import type { LeadRow, LeadStatus } from "@/lib/supabase/types";
import { relTime } from "@/lib/format";

// Leads pipeline (SELENE_OS_SPEC.md §3.3). Status flow: new -> enriched ->
// contacted -> replied -> qualified -> closed/dead. Plumbing built now so it
// lights up once the metisanalytic.com form + Charon enrichment land.

const COLUMNS: LeadStatus[] = ["new", "enriched", "contacted", "replied", "qualified", "closed", "dead"];

export default function LeadsView() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);
  function supabase(): SupabaseBrowserClient {
    return supabaseRef.current ?? (supabaseRef.current = createClient());
  }

  useEffect(() => {
    let cancelled = false;

    supabase().from("leads").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      if (cancelled) return;
      setLeads((data as LeadRow[] | null) ?? []);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function upsert(row: LeadRow) {
      setLeads((prev) => {
        const exists = prev.some((l) => l.id === row.id);
        return exists ? prev.map((l) => (l.id === row.id ? row : l)) : [row, ...prev];
      });
    }

    return subscribeToLeads({
      onInsert: upsert,
      onUpdate: upsert,
      onDelete: (oldRow) => setLeads((prev) => prev.filter((l) => l.id !== oldRow.id)),
    });
  }, []);

  async function moveTo(lead: LeadRow, status: LeadStatus) {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l)));
    const { error } = await supabase().from("leads").update({ status }).eq("id", lead.id);
    if (error) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
      return;
    }
    await supabase().from("lead_events").insert({ lead_id: lead.id, event_type: "status_change", detail: status });
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Leads</div>
        <div className={`${styles.count} mono`}>{leads.length} total</div>
      </div>

      {loaded && leads.length === 0 ? (
        <div className={styles.empty}>No leads yet. They&apos;ll show up here from the metis form or inbox triage.</div>
      ) : (
        <div className={styles.board}>
          {COLUMNS.map((status) => {
            const inCol = leads.filter((l) => l.status === status);
            return (
              <div key={status} className={styles.col}>
                <div className={styles.colHeader}>
                  <span>{status}</span>
                  <span className="mono">{inCol.length}</span>
                </div>
                <div className={styles.colBody}>
                  {inCol.map((lead) => (
                    <div key={lead.id} className={styles.card}>
                      <div className={styles.cardName}>{lead.name || lead.email || "Unnamed"}</div>
                      {lead.company && <div className={styles.cardCompany}>{lead.company}</div>}
                      <div className={styles.cardMeta}>
                        <span className={styles.sourceTag}>{lead.source.replace("_", " ")}</span>
                        {lead.score !== null && <span className={styles.score}>{lead.score}</span>}
                      </div>
                      {lead.message && <div className={styles.cardMessage}>{lead.message}</div>}
                      <span className={styles.ts}>{relTime(lead.created_at)}</span>
                      <select
                        className={styles.statusSelect}
                        value={lead.status}
                        onChange={(e) => moveTo(lead, e.target.value as LeadStatus)}
                      >
                        {COLUMNS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
