"use client";
import { useState } from "react";
import styles from "./ReportIssueForm.module.css";

interface ReportIssueFormProps {
  runId: string;
  reportKind: "quick" | "deep-dive";
  entityName: string;
  sectionTitles: string[];
}

/**
 * Task 3.4 — "Something wrong in this report?" One instance per report
 * view (not per-section — the section itself is a field in the form),
 * shared across all three report-rendering surfaces (ReportViewer,
 * DeepDiveViewer, print/[id]/page.tsx).
 */
export default function ReportIssueForm({ runId, reportKind, entityName, sectionTitles }: ReportIssueFormProps) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(sectionTitles[0] ?? "");
  const [message, setMessage] = useState("");
  const [correctValue, setCorrectValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailtoUrl, setMailtoUrl] = useState<string | null>(null);

  async function handleSubmit() {
    if (!message.trim()) { setError("Let us know what's wrong first."); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch("/api/report-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, reportKind, entityName, section, message, correctValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save your report.");
      setMailtoUrl(data.mailtoUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your report.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mailtoUrl) {
    return (
      <div className={styles.wrap}>
        <div className={styles.done}>
          Thanks — we&apos;ve logged it.{" "}
          <a href={mailtoUrl}>Email us the details too →</a>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
          ⚑ Something wrong in this report?
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.form}>
        {sectionTitles.length > 0 && (
          <select className={styles.select} value={section} onChange={(e) => setSection(e.target.value)}>
            {sectionTitles.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <textarea
          className={styles.textarea}
          placeholder="What's wrong?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
        />
        <input
          className={styles.input}
          placeholder="Correct value (optional)"
          value={correctValue}
          onChange={(e) => setCorrectValue(e.target.value)}
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className={styles.submit} onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
