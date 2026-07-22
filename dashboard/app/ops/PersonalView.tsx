"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./PersonalView.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { PersonalGoalRow } from "@/lib/supabase/types";
import { formatDate, daysUntilDate } from "@/lib/format";

// Personal — Nick's own goals/countdowns, kept separate from Zuse Holdings
// business ops. A dated goal renders as a countdown (same visual language
// as the compliance clock); an undated one is just a standing note. The
// topbar's UCLA/$1M tiles are still their own fixed constants — this is
// the real, extensible tracker for anything added after those two.

function toneFor(days: number): "bad" | "warn" | "ok" {
  if (days <= 7) return "bad";
  if (days <= 30) return "warn";
  return "ok";
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface FormState {
  title: string;
  target_date: string;
  notes: string;
}

const EMPTY_FORM: FormState = { title: "", target_date: "", notes: "" };

export default function PersonalView() {
  const [active, setActive] = useState<PersonalGoalRow[]>([]);
  const [done, setDone] = useState<PersonalGoalRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);
  function supabase(): SupabaseBrowserClient {
    return supabaseRef.current ?? (supabaseRef.current = createClient());
  }

  async function loadAll() {
    const db = supabase();
    const [activeRes, doneRes] = await Promise.all([
      db.from("personal_goals").select("*").eq("status", "active")
        .order("target_date", { ascending: true, nullsFirst: false }),
      db.from("personal_goals").select("*").eq("status", "done")
        .order("completed_at", { ascending: false }).limit(10),
    ]);
    setActive((activeRes.data as PersonalGoalRow[] | null) ?? []);
    setDone((doneRes.data as PersonalGoalRow[] | null) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markDone(row: PersonalGoalRow) {
    setActive((prev) => prev.filter((r) => r.id !== row.id));
    const { error } = await supabase()
      .from("personal_goals")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      setActive((prev) => [...prev, row]);
      return;
    }
    setDone((prev) => [{ ...row, status: "done" }, ...prev]);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitGoal(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.title.trim()) return setFormError("Give it a title.");

    setSubmitting(true);
    const { error } = await supabase().from("personal_goals").insert({
      title: form.title.trim(),
      target_date: form.target_date || null,
      notes: form.notes.trim() || null,
    });
    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    loadAll();
  }

  const dated = active.filter((g) => g.target_date);
  const undated = active.filter((g) => !g.target_date);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Personal</div>
        <div className={styles.count}>{active.length} active</div>
      </div>

      {loaded && active.length === 0 && (
        <div className={styles.empty}>Nothing on your list. Add something below.</div>
      )}

      <div className={styles.list}>
        {dated.map((goal) => {
          const days = daysUntilDate(goal.target_date!);
          const tone = toneFor(days);
          return (
            <div key={goal.id} className={`${styles.row} ${styles[tone]}`}>
              <div className={styles.days}>{days < 0 ? `${Math.abs(days)}d over` : `${days}d`}</div>
              <div className={styles.body}>
                <div className={styles.rowTitle}>{goal.title}</div>
                <div className={styles.rowMeta}>
                  <span className={`${styles.date} mono`}>{formatDate(goal.target_date!)}</span>
                </div>
                {goal.notes && <div className={styles.notes}>{goal.notes}</div>}
              </div>
              <button className={styles.doneBtn} onClick={() => markDone(goal)}>Mark done</button>
            </div>
          );
        })}

        {undated.map((goal) => (
          <div key={goal.id} className={`${styles.row} ${styles.undated}`}>
            <div className={styles.days}>no date</div>
            <div className={styles.body}>
              <div className={styles.rowTitle}>{goal.title}</div>
              {goal.notes && <div className={styles.notes}>{goal.notes}</div>}
            </div>
            <button className={styles.doneBtn} onClick={() => markDone(goal)}>Mark done</button>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Add something</div>
        <form className={styles.form} onSubmit={submitGoal}>
          <div className={styles.field}>
            <label>Title</label>
            <input value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder="What are you tracking?" />
          </div>
          <div className={styles.field}>
            <label>Target date (optional)</label>
            <input type="date" value={form.target_date} min={todayIso()} onChange={(e) => updateField("target_date", e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Notes (optional)</label>
            <input value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="context, stakes, whatever's useful" />
          </div>
          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? "Adding…" : "Add"}
          </button>
          {formError && <span className={styles.formError}>{formError}</span>}
        </form>
      </div>

      {done.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Recently done</div>
          <div className={styles.doneSection}>
            {done.map((goal) => (
              <div key={goal.id} className={styles.doneRow}>
                <span>{goal.title}</span>
                <span className={`${styles.date} mono`}>{goal.target_date ? formatDate(goal.target_date) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
