"use client";
import styles from "./ResearchSkeleton.module.css";

/** One source's live state, written by the agent server while the run
 *  is in flight (src/lib/coverage/recorder.ts ProgressEvent). */
export interface RunProgress {
  id: string;
  name: string;
  state: "running" | "done" | "empty" | "failed";
  count?: number;
  reason?: string;
}

interface Props {
  subject: string;
  type: "company" | "person" | "product" | "political" | "creator";
  /** Real per-source progress. Company and person runs report it; other
   *  types (and the first second of any run) fall back to the generic
   *  step list below. */
  progress?: RunProgress[];
}

// Glyph + word for every state, so status never relies on color alone.
const STATE_GLYPH: Record<RunProgress["state"], string> = { running: "▸", done: "✓", empty: "–", failed: "✕" };

function stateLabel(p: RunProgress): string {
  switch (p.state) {
    case "running": return "Searching…";
    case "done":    return `${p.count ?? 0} found`;
    case "empty":   return "Nothing found";
    case "failed":  return p.reason ? `Failed · ${p.reason.replace(/\.$/, "")}` : "Failed";
  }
}

const STEPS = [
  "Locating official sources",
  "Gathering news and announcements",
  "Analyzing leadership and team",
  "Researching competitors",
  "Extracting funding data",
  "Running LLM analysis",
  "Synthesizing report",
];

export default function ResearchSkeleton({ subject, type, progress }: Props) {
  const live = progress && progress.length > 0 ? progress : null;
  const finished = live ? live.filter(p => p.state !== "running").length : 0;
  const failed = live ? live.filter(p => p.state === "failed").length : 0;

  return (
    <div className={styles.skeleton}>
      <div className={styles.header}>
        <div className={styles.iconWrap}>
          <span className={`${styles.icon} ${styles.pulse}`}>
            {type === "company" ? "◈" : type === "person" ? "◎" : "⬡"}
          </span>
        </div>
        <div>
          <div className={styles.title}>{subject}</div>
          <div className={styles.sub}>
            {live
              ? `${finished} of ${live.length} sources checked${failed ? ` · ${failed} failed, the report will cover the rest` : ""}`
              : "Research in progress"}
          </div>
        </div>
      </div>

      <div className={styles.progressTrack}>
        {live
          ? <div className={styles.progressFillLive} style={{ width: `${Math.max(6, Math.round((finished / live.length) * 100))}%` }} />
          : <div className={styles.progressFill} />}
      </div>

      {live ? (
        <ul className={styles.liveSteps} aria-live="polite">
          {live.map(p => (
            <li key={p.id} className={`${styles.liveStep} ${styles[p.state]}`}>
              <span className={styles.liveGlyph} aria-hidden="true">{STATE_GLYPH[p.state]}</span>
              <span className={styles.liveName}>{p.name}</span>
              <span className={styles.liveState}>{stateLabel(p)}</span>
            </li>
          ))}
        </ul>
      ) : (
      <div className={styles.steps}>
        {STEPS.map((step, i) => (
          <div
            key={i}
            className={styles.step}
            // Two animations on this element (see fade-in / step-cycle in
            // the CSS module) — the delay list lines up 1:1 with them:
            // fade-in staggers the initial reveal, step-cycle staggers the
            // ongoing breathing loop so steps don't all pulse in lockstep.
            style={{ animationDelay: `${i * 0.4}s, ${i * 0.35}s` }}
          >
            <span className={styles.stepDot} />
            <span className={styles.stepText}>{step}</span>
          </div>
        ))}
      </div>

      )}

      <div className={styles.blocks}>
        {[180, 120, 200, 90, 150].map((w, i) => (
          <div key={i} className={styles.block} style={{ width: `${w}px`, animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}
