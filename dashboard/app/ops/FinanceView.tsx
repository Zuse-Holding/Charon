"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./FinanceView.module.css";
import { createClient, type SupabaseBrowserClient } from "../../lib/supabase/client";
import type { LedgerRow, RecurringCostRow, Venture } from "@/lib/supabase/types";
import { formatMoney, formatDate } from "@/lib/format";

// Finance (SELENE_OS_SPEC.md §3.2) — manual-first ledger. No bank feeds in v1,
// so "runway" isn't shown here: that needs a cash-balance figure the schema
// doesn't track yet. Burn/category/venture splits are the real Phase 1 asks.

const VENTURES: Venture[] = ["zuse", "metis", "charon", "lounge", "kairos", "personal_mixed"];
const CATEGORY_SUGGESTIONS = ["software", "domains", "hardware", "filing_fees", "api", "hosting", "other"];

const MONTH_LABEL = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

function monthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface FormState {
  vendor: string;
  description: string;
  amount: string;
  direction: "out" | "in";
  category: string;
  venture: Venture;
  deductible: boolean;
  business_use_pct: string;
  entry_date: string;
}

const EMPTY_FORM: FormState = {
  vendor: "",
  description: "",
  amount: "",
  direction: "out",
  category: "",
  venture: "zuse",
  deductible: true,
  business_use_pct: "100",
  entry_date: todayIso(),
};

interface RecurringDraft {
  vendor: string;
  description: string;
  amount: string;
  cadence: "monthly" | "annual" | "usage";
  next_renewal: string;
}

function draftFromRow(row: RecurringCostRow): RecurringDraft {
  return {
    vendor: row.vendor,
    description: row.description ?? "",
    amount: String(row.amount),
    cadence: row.cadence,
    next_renewal: row.next_renewal ?? "",
  };
}

interface NewRecurringForm {
  vendor: string;
  description: string;
  amount: string;
  cadence: "monthly" | "annual" | "usage";
  next_renewal: string;
  venture: Venture;
  category: string;
}

const EMPTY_NEW_RECURRING: NewRecurringForm = {
  vendor: "", description: "", amount: "", cadence: "monthly",
  next_renewal: "", venture: "zuse", category: "",
};

export default function FinanceView() {
  const [monthEntries, setMonthEntries] = useState<LedgerRow[]>([]);
  const [recent, setRecent] = useState<LedgerRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringCostRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [recurringEditingId, setRecurringEditingId] = useState<string | null>(null);
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraft | null>(null);
  const [recurringSaving, setRecurringSaving] = useState(false);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [newRecurring, setNewRecurring] = useState<NewRecurringForm>(EMPTY_NEW_RECURRING);
  const [newRecurringError, setNewRecurringError] = useState<string | null>(null);
  const [newRecurringSaving, setNewRecurringSaving] = useState(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);
  function supabase(): SupabaseBrowserClient {
    return supabaseRef.current ?? (supabaseRef.current = createClient());
  }

  async function loadAll() {
    const db = supabase();
    const { start, end } = monthRange();
    const [monthRes, recentRes, recurringRes] = await Promise.all([
      db.from("ledger").select("*").gte("entry_date", start).lt("entry_date", end),
      db.from("ledger").select("*").order("entry_date", { ascending: false }).limit(20),
      db.from("recurring_costs").select("*").eq("active", true).order("vendor", { ascending: true }),
    ]);
    setMonthEntries((monthRes.data as LedgerRow[] | null) ?? []);
    setRecent((recentRes.data as LedgerRow[] | null) ?? []);
    setRecurring((recurringRes.data as RecurringCostRow[] | null) ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const burnTotal = monthEntries.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
  const inTotal = monthEntries.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);

  function breakdown(key: "category" | "venture"): { k: string; v: number }[] {
    const totals = new Map<string, number>();
    for (const e of monthEntries) {
      if (e.direction !== "out") continue;
      const k = e[key];
      totals.set(k, (totals.get(k) ?? 0) + Number(e.amount));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v }));
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const amount = Number(form.amount);
    if (!form.vendor.trim()) return setFormError("Vendor is required.");
    if (!form.category.trim()) return setFormError("Category is required.");
    if (!Number.isFinite(amount) || amount < 0) return setFormError("Amount must be a positive number.");
    const pct = Number(form.business_use_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setFormError("Business use % must be 0–100.");

    setSubmitting(true);
    const { error } = await supabase().from("ledger").insert({
      vendor: form.vendor.trim(),
      description: form.description.trim() || null,
      amount,
      direction: form.direction,
      category: form.category.trim(),
      venture: form.venture,
      deductible: form.deductible,
      business_use_pct: pct,
      entry_date: form.entry_date,
      source: "manual",
    });
    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setForm({ ...EMPTY_FORM, entry_date: todayIso() });
    loadAll();
  }

  function startEditRecurring(row: RecurringCostRow) {
    setRecurringError(null);
    setRecurringEditingId(row.id);
    setRecurringDraft(draftFromRow(row));
  }

  function cancelEditRecurring() {
    setRecurringEditingId(null);
    setRecurringDraft(null);
    setRecurringError(null);
  }

  function updateRecurringDraft<K extends keyof RecurringDraft>(key: K, value: RecurringDraft[K]) {
    setRecurringDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveRecurring(id: string) {
    if (!recurringDraft) return;
    setRecurringError(null);

    const amount = Number(recurringDraft.amount);
    if (!recurringDraft.vendor.trim()) return setRecurringError("Vendor is required.");
    if (!Number.isFinite(amount) || amount < 0) return setRecurringError("Amount must be a positive number.");

    setRecurringSaving(true);
    const { error } = await supabase().from("recurring_costs").update({
      vendor: recurringDraft.vendor.trim(),
      description: recurringDraft.description.trim() || null,
      amount,
      cadence: recurringDraft.cadence,
      next_renewal: recurringDraft.next_renewal || null,
    }).eq("id", id);
    setRecurringSaving(false);

    if (error) {
      setRecurringError(error.message);
      return;
    }
    setRecurringEditingId(null);
    setRecurringDraft(null);
    loadAll();
  }

  async function deactivateRecurring(id: string) {
    await supabase().from("recurring_costs").update({ active: false }).eq("id", id);
    loadAll();
  }

  function updateNewRecurring<K extends keyof NewRecurringForm>(key: K, value: NewRecurringForm[K]) {
    setNewRecurring((prev) => ({ ...prev, [key]: value }));
  }

  async function submitNewRecurring(e: React.FormEvent) {
    e.preventDefault();
    setNewRecurringError(null);

    const amount = Number(newRecurring.amount);
    if (!newRecurring.vendor.trim()) return setNewRecurringError("Vendor is required.");
    if (!newRecurring.category.trim()) return setNewRecurringError("Category is required.");
    if (!Number.isFinite(amount) || amount < 0) return setNewRecurringError("Amount must be a positive number.");

    setNewRecurringSaving(true);
    const { error } = await supabase().from("recurring_costs").insert({
      vendor: newRecurring.vendor.trim(),
      description: newRecurring.description.trim() || null,
      amount,
      cadence: newRecurring.cadence,
      next_renewal: newRecurring.next_renewal || null,
      venture: newRecurring.venture,
      category: newRecurring.category.trim(),
      active: true,
    });
    setNewRecurringSaving(false);

    if (error) {
      setNewRecurringError(error.message);
      return;
    }
    setNewRecurring(EMPTY_NEW_RECURRING);
    setShowAddRecurring(false);
    loadAll();
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Finance</div>
        <div className={`${styles.subtitle} mono`}>{MONTH_LABEL}</div>
      </div>

      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Burn this month</div>
          <div className={styles.statVal}>{formatMoney(burnTotal)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>In this month</div>
          <div className={`${styles.statVal} ${styles.in}`}>{formatMoney(inTotal)}</div>
        </div>
      </div>

      <div className={styles.splitRow}>
        <div className={styles.splitCol}>
          <div className={styles.sectionTitle}>By category</div>
          {loaded && breakdown("category").length === 0 && <div className={styles.empty}>Nothing logged this month yet.</div>}
          {breakdown("category").map(({ k, v }) => (
            <div key={k} className={styles.splitLine}>
              <span className={styles.k}>{k}</span>
              <span className={`${styles.v} mono`}>{formatMoney(v)}</span>
            </div>
          ))}
        </div>
        <div className={styles.splitCol}>
          <div className={styles.sectionTitle}>By venture</div>
          {loaded && breakdown("venture").length === 0 && <div className={styles.empty}>Nothing logged this month yet.</div>}
          {breakdown("venture").map(({ k, v }) => (
            <div key={k} className={styles.splitLine}>
              <span className={styles.k}>{k.replace("_", " ")}</span>
              <span className={`${styles.v} mono`}>{formatMoney(v)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Add entry</div>
        <form className={styles.form} onSubmit={submitEntry}>
          <div className={`${styles.field} ${styles.span2}`}>
            <label>Vendor</label>
            <input value={form.vendor} onChange={(e) => updateField("vendor", e.target.value)} placeholder="Namecheap" />
          </div>
          <div className={`${styles.field} ${styles.span2}`}>
            <label>Description</label>
            <input value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="optional" />
          </div>
          <div className={styles.field}>
            <label>Amount</label>
            <input
              type="number" min="0" step="0.01"
              value={form.amount}
              onChange={(e) => updateField("amount", e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className={styles.field}>
            <label>Direction</label>
            <select value={form.direction} onChange={(e) => updateField("direction", e.target.value as "out" | "in")}>
              <option value="out">Out (expense)</option>
              <option value="in">In (revenue)</option>
            </select>
          </div>
          <div className={styles.field}>
            <label>Category</label>
            <input
              list="category-suggestions"
              value={form.category}
              onChange={(e) => updateField("category", e.target.value)}
              placeholder="software"
            />
            <datalist id="category-suggestions">
              {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className={styles.field}>
            <label>Venture</label>
            <select value={form.venture} onChange={(e) => updateField("venture", e.target.value as Venture)}>
              {VENTURES.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label>Date</label>
            <input type="date" value={form.entry_date} onChange={(e) => updateField("entry_date", e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Business use %</label>
            <input
              type="number" min="0" max="100"
              value={form.business_use_pct}
              onChange={(e) => updateField("business_use_pct", e.target.value)}
            />
          </div>
          <div className={`${styles.field} ${styles.checkField}`}>
            <input
              type="checkbox" id="deductible"
              checked={form.deductible}
              onChange={(e) => updateField("deductible", e.target.checked)}
            />
            <label htmlFor="deductible">Deductible</label>
          </div>
          <div className={styles.submitRow}>
            {formError && <span className={styles.formError}>{formError}</span>}
            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? "Adding…" : "Add to ledger"}
            </button>
          </div>
        </form>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Recent entries</div>
        {loaded && recent.length === 0 ? (
          <div className={styles.empty}>No entries yet. Add the first one above.</div>
        ) : (
          <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th><th>Vendor</th><th>Category</th><th>Venture</th><th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td className={styles.dateCell}>{formatDate(row.entry_date)}</td>
                  <td>{row.vendor}</td>
                  <td><span className={styles.tag}>{row.category}</span></td>
                  <td>{row.venture.replace("_", " ")}</td>
                  <td className={`${styles.amt} ${row.direction === "in" ? styles.in : ""}`}>
                    {row.direction === "in" ? "+" : "−"}{formatMoney(Number(row.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.recurringHeader}>
          <div className={styles.sectionTitle}>Recurring costs</div>
          <span className={styles.linkBtn} onClick={() => setShowAddRecurring((v) => !v)}>
            {showAddRecurring ? "cancel" : "+ add"}
          </span>
        </div>

        {showAddRecurring && (
          <form className={styles.recurringAddForm} onSubmit={submitNewRecurring}>
            <div className={styles.field}>
              <label>Vendor</label>
              <input value={newRecurring.vendor} onChange={(e) => updateNewRecurring("vendor", e.target.value)} placeholder="Vendor" />
            </div>
            <div className={styles.field}>
              <label>Description</label>
              <input value={newRecurring.description} onChange={(e) => updateNewRecurring("description", e.target.value)} placeholder="optional" />
            </div>
            <div className={styles.field}>
              <label>Amount</label>
              <input type="number" min="0" step="0.01" value={newRecurring.amount} onChange={(e) => updateNewRecurring("amount", e.target.value)} placeholder="0.00" />
            </div>
            <div className={styles.field}>
              <label>Cadence</label>
              <select value={newRecurring.cadence} onChange={(e) => updateNewRecurring("cadence", e.target.value as NewRecurringForm["cadence"])}>
                <option value="monthly">monthly</option>
                <option value="annual">annual</option>
                <option value="usage">usage</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>Next renewal</label>
              <input type="date" value={newRecurring.next_renewal} onChange={(e) => updateNewRecurring("next_renewal", e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Category</label>
              <input list="category-suggestions" value={newRecurring.category} onChange={(e) => updateNewRecurring("category", e.target.value)} placeholder="software" />
            </div>
            <div className={styles.field}>
              <label>Venture</label>
              <select value={newRecurring.venture} onChange={(e) => updateNewRecurring("venture", e.target.value as Venture)}>
                {VENTURES.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
              </select>
            </div>
            <div className={styles.recurringAddSubmit}>
              {newRecurringError && <span className={styles.formError}>{newRecurringError}</span>}
              <button type="submit" className={styles.submitBtn} disabled={newRecurringSaving}>
                {newRecurringSaving ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        )}

        {loaded && recurring.length === 0 ? (
          <div className={styles.empty}>Nothing seeded yet.</div>
        ) : (
          <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Vendor</th><th>Cadence</th><th>Next renewal</th><th>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((row) => {
                const isEditing = recurringEditingId === row.id;
                if (isEditing && recurringDraft) {
                  return (
                    <tr key={row.id}>
                      <td>
                        <input className={styles.cellInput} value={recurringDraft.vendor}
                          onChange={(e) => updateRecurringDraft("vendor", e.target.value)} />
                        <input className={styles.cellInput} value={recurringDraft.description}
                          onChange={(e) => updateRecurringDraft("description", e.target.value)} placeholder="description" />
                      </td>
                      <td>
                        <select className={styles.cellInput} value={recurringDraft.cadence}
                          onChange={(e) => updateRecurringDraft("cadence", e.target.value as RecurringDraft["cadence"])}>
                          <option value="monthly">monthly</option>
                          <option value="annual">annual</option>
                          <option value="usage">usage</option>
                        </select>
                      </td>
                      <td>
                        <input type="date" className={styles.cellInput} value={recurringDraft.next_renewal}
                          onChange={(e) => updateRecurringDraft("next_renewal", e.target.value)} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" className={styles.cellInput} value={recurringDraft.amount}
                          onChange={(e) => updateRecurringDraft("amount", e.target.value)} />
                      </td>
                      <td className={styles.rowActions}>
                        <span className={styles.linkBtn} onClick={() => saveRecurring(row.id)}>
                          {recurringSaving ? "saving…" : "save"}
                        </span>
                        <span className={styles.linkBtn} onClick={cancelEditRecurring}>cancel</span>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={row.id}>
                    <td>{row.vendor}{row.description ? ` — ${row.description}` : ""}</td>
                    <td><span className={styles.tag}>{row.cadence}</span></td>
                    <td className={styles.dateCell}>{row.next_renewal ? formatDate(row.next_renewal) : "—"}</td>
                    <td className={styles.amt}>{formatMoney(Number(row.amount))}</td>
                    <td className={styles.rowActions}>
                      <span className={styles.linkBtn} onClick={() => startEditRecurring(row)}>edit</span>
                      <span className={styles.linkBtn} onClick={() => deactivateRecurring(row.id)}>deactivate</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        {recurringError && <div className={styles.formError}>{recurringError}</div>}
      </div>
    </div>
  );
}
