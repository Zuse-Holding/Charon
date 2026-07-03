"use client";
import { useState, useEffect, useRef } from "react";
import styles from "./DeepDiveProgress.module.css";

const SECTION_ESTIMATES: Record<string, number> = {
  "Executive Brief": 15,
  "Founding & History": 20,
  "Leadership Deep Dive": 25,
  "Funding & Financials": 25,
  "Products & Traction": 25,
  "Risk Flags": 20,
  "Competitive Context": 25,
  "Market Sizing": 20,
  "Strategic Options": 20,
  "Verdict": 15,
};

const SECTION_ORDER = Object.keys(SECTION_ESTIMATES);
const TOTAL_ESTIMATED_SECONDS = Object.values(SECTION_ESTIMATES).reduce((a, b) => a + b, 0);

type SectionStatus = "queued" | "running" | "done";

interface Props {
  company: string;
  onComplete: (sections: { title: string; content: string; riskLevel?: string }[]) => void;
  onCancel: () => void;
}

export default function DeepDiveProgress({ company, onComplete, onCancel }: Props) {
  const [started, setStarted]         = useState(false);
  const [statuses, setStatuses]       = useState<SectionStatus[]>(
    SECTION_ORDER.map(() => "queued")
  );
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_ESTIMATED_SECONDS);
  const [error, setError]             = useState<string | null>(null);
  const sections = useRef<{ title: string; content: string; riskLevel?: string }[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function completedCount() {
    return statuses.filter(s => s === "done").length;
  }

  function progressPercent() {
    return Math.round((completedCount() / SECTION_ORDER.length) * 100);
  }

  useEffect(() => {
    if (!started) return;

    abortRef.current = new AbortController();

    timerRef.current = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1));
    }, 1000);

    async function run() {
      try {
        const res = await fetch("/api/deep-dive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company }),
          signal: abortRef.current?.signal,
        });

        if (!res.ok || !res.body) {
          setError("Server error — please try again.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));

              if (event.type === "section_start") {
                setCurrentSection(event.section);
                setStatuses(prev => {
                  const next = [...prev];
                  next[event.sectionIndex] = "running";
                  return next;
                });
                // Adjust time remaining based on remaining sections
                const remaining = SECTION_ORDER
                  .slice(event.sectionIndex)
                  .reduce((acc, s) => acc + (SECTION_ESTIMATES[s] ?? 20), 0);
                setSecondsLeft(remaining);
              }

              if (event.type === "section_done") {
                setStatuses(prev => {
                  const next = [...prev];
                  next[event.sectionIndex] = "done";
                  return next;
                });
                sections.current.push({
                  title: event.section,
                  content: event.content ?? "",
                });
              }

              if (event.type === "complete") {
                if (timerRef.current) clearInterval(timerRef.current);
                setSecondsLeft(0);
                setStatuses(SECTION_ORDER.map(() => "done"));
                setTimeout(() => onComplete(sections.current), 600);
              }

              if (event.type === "error") {
                setError(event.error ?? "Unknown error");
              }
            } catch {
              // Malformed event — skip
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message ?? "Connection failed");
        }
      } finally {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }

    run();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, [started]);

  function formatTime(s: number) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
  }

  // Pre-start confirmation state
  if (!started) {
    return (
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalIcon}>◉</span>
          <div>
            <div className={styles.modalTitle}>Deep Dive Analysis</div>
            <div className={styles.modalSub}>{company}</div>
          </div>
        </div>

        <div className={styles.estimate}>
          Estimated time: <strong>~{formatTime(TOTAL_ESTIMATED_SECONDS)}</strong>
        </div>

        <div className={styles.sectionList}>
          {SECTION_ORDER.map((section, i) => (
            <div key={i} className={styles.sectionQueued}>
              <span className={styles.dot}>○</span>
              <span className={styles.sectionName}>{section}</span>
              <span className={styles.sectionTime}>~{SECTION_ESTIMATES[section]}s</span>
            </div>
          ))}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button className={styles.startBtn} onClick={() => setStarted(true)}>
            Start Deep Dive →
          </button>
        </div>
      </div>
    );
  }

  // Running state
  return (
    <div className={styles.running}>
      <div className={styles.runHeader}>
        <span className={`${styles.modalIcon} ${styles.pulse}`}>◉</span>
        <div>
          <div className={styles.modalTitle}>Analyzing {company}</div>
          <div className={styles.modalSub}>
            {error
              ? `Error: ${error}`
              : progressPercent() === 100
              ? "Complete — loading report..."
              : `${currentSection ?? "Starting..."} — ~${formatTime(secondsLeft)} remaining`
            }
          </div>
        </div>
      </div>

      <div className={styles.progressTrack}>
        <div
          className={`${styles.progressFill} ${progressPercent() === 100 ? styles.complete : ""}`}
          style={{ width: `${progressPercent()}%` }}
        />
      </div>
      <div className={styles.progressLabel}>
        {progressPercent()}% — {completedCount()} of {SECTION_ORDER.length} sections
      </div>

      <div className={styles.sectionList}>
        {SECTION_ORDER.map((section, i) => {
          const status = statuses[i];
          return (
            <div
              key={i}
              className={`${styles.sectionRow} ${styles[status]}`}
            >
              <span className={styles.dot}>
                {status === "done" ? "✓" : status === "running" ? "◉" : "○"}
              </span>
              <span className={styles.sectionName}>{section}</span>
              {status === "running" && (
                <span className={styles.runningLabel}>running...</span>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <button className={styles.cancelBtn} onClick={onCancel}>
          Close
        </button>
      )}
    </div>
  );
}
