"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./DeepDiveProgress.module.css";

interface Section {
  title: string;
  content: string;
  riskLevel?: string;
}

interface Props {
  company: string;
  onComplete: (sections: Section[]) => void;
  onCancel: () => void;
}

const SECTION_TITLES = [
  "Executive Brief",
  "Founding & History",
  "Leadership Deep Dive",
  "Business Model",
  "Products & Traction",
  "Funding & Financials",
  "Competitive Context",
  "Risk Flags",
  "Strategic Options",
  "Verdict",
];

export default function DeepDiveProgress({ company, onComplete, onCancel }: Props) {
  const [confirming, setConfirming]   = useState(true);
  const [running, setRunning]         = useState(false);
  const [sections, setSections]       = useState<Section[]>([]);
  const [currentSection, setCurrentSection] = useState<string>("");
  const [progress, setProgress]       = useState(0);
  const [error, setError]             = useState<string | null>(null);
  const [deepDiveId, setDeepDiveId]   = useState<string | null>(null);
  const abortRef                      = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  async function startDeepDive() {
    setConfirming(false);
    setRunning(true);
    setError(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/deep-dive?company=${encodeURIComponent(company)}`, {
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Deep dive request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const collectedSections: Section[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json || json === "[DONE]") continue;

          try {
            const event = JSON.parse(json);
            if (event.type === "section") {
              const section: Section = {
                title: event.title,
                content: event.content,
                riskLevel: event.riskLevel,
              };
              collectedSections.push(section);
              setSections([...collectedSections]);
              setCurrentSection(event.title);
              setProgress(Math.round((collectedSections.length / 10) * 100));
            } else if (event.type === "complete") {
              setProgress(100);
              setRunning(false);

              // Save to Supabase
              try {
                const saveRes = await fetch("/api/deep-dives", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    company,
                    sections: collectedSections,
                    durationMs: event.durationMs ?? 0,
                  }),
                });
                if (saveRes.ok) {
                  const saved = await saveRes.json();
                  setDeepDiveId(saved.id);
                }
              } catch {
                // Save failure is non-fatal
              }

              onComplete(collectedSections);
            } else if (event.type === "error") {
              throw new Error(event.message ?? "Unknown error");
            }
          } catch { /* skip malformed events */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "Something went wrong");
      setRunning(false);
    }
  }

  if (confirming) {
    return (
      <div className={styles.confirm}>
        <div className={styles.confirmIcon}>◆</div>
        <h3 className={styles.confirmTitle}>Start Deep Dive on {company}?</h3>
        <p className={styles.confirmDesc}>
          Generates a 10-section analyst report. Takes 3-5 minutes.
          Please stay on this page until it completes.
        </p>
        <div className={styles.confirmActions}>
          <button className={styles.confirmBtn} onClick={startDeepDive}>
            Start Deep Dive →
          </button>
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.progress}>
      <div className={styles.progressHeader}>
        <span className={styles.progressTitle}>Deep Dive — {company}</span>
        <span className={styles.progressPct}>{progress}%</span>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>

      <div className={styles.sectionList}>
        {SECTION_TITLES.map((title, i) => {
          const done = sections.find(s => s.title === title);
          const active = currentSection === title && running;
          return (
            <div
              key={title}
              className={`${styles.sectionItem} ${done ? styles.done : ""} ${active ? styles.active : ""}`}
            >
              <span className={styles.sectionCheck}>{done ? "✓" : active ? "◉" : "○"}</span>
              <span className={styles.sectionName}>{title}</span>
            </div>
          );
        })}
      </div>

      {error && <div className={styles.errorMsg}>✗ {error}</div>}

      {running && (
        <div className={styles.navWarning}>
          ⚠ Deep Dive in progress — please don't navigate away
        </div>
      )}

      {!running && !error && deepDiveId && (
        <div className={styles.savedNote}>
          ✓ Deep Dive saved ·{" "}
          <a
            href={`/print/${deepDiveId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.printLink}
          >
            Export clean PDF →
          </a>
        </div>
      )}
    </div>
  );
}
