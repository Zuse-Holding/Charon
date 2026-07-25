"use client";
import styles from "./ResearchSkeleton.module.css";

interface Props {
  subject: string;
  type: "company" | "person" | "product" | "political" | "creator";
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

export default function ResearchSkeleton({ subject, type }: Props) {
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
          <div className={styles.sub}>Research in progress</div>
        </div>
      </div>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} />
      </div>

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

      <div className={styles.blocks}>
        {[180, 120, 200, 90, 150].map((w, i) => (
          <div key={i} className={styles.block} style={{ width: `${w}px`, animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}
