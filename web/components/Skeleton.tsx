import { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

/**
 * Ghost placeholders shown while a page's first fetch is in flight —
 * stands in for the real rows so the layout doesn't jump, and so empty
 * states ("No reports found") only show once we actually know there's
 * nothing, instead of flashing on every load.
 */

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
  className?: string;
}

export function Skeleton({ width = "100%", height = 10, radius = 4, style, className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`${styles.bone} ${className ?? ""}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Two-line ghost row — a title bar plus a shorter meta bar. Covers most
 *  list/card rows in the app (feed items, watchlist cards, recent runs). */
export function SkeletonRow({ index = 0, style }: { index?: number; style?: CSSProperties }) {
  // Vary widths by position so a stack of rows reads as content, not a barcode.
  const widths = [72, 58, 84, 64, 76, 52];
  const w = widths[index % widths.length];
  return (
    <div className={styles.row} style={{ animationDelay: `${index * 0.08}s`, ...style }}>
      <Skeleton width={`${w}%`} height={11} />
      <Skeleton width={`${Math.round(w * 0.5)}%`} height={8} style={{ opacity: 0.6 }} />
    </div>
  );
}

/** Stacked paragraph lines — a stand-in for a markdown report body. */
export function SkeletonText({ lines = 6 }: { lines?: number }) {
  const widths = [96, 88, 92, 70, 94, 82, 60];
  return (
    <div className={styles.text}>
      <Skeleton width="38%" height={18} style={{ marginBottom: 10 }} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${widths[i % widths.length]}%`} height={10} />
      ))}
    </div>
  );
}

/** Small ring spinner, inherits color from `currentColor` unless given one. */
export function Spinner({ size = 14, color, label }: { size?: number; color?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Loading"}
      className={styles.spinner}
      style={{ width: size, height: size, color }}
    />
  );
}
