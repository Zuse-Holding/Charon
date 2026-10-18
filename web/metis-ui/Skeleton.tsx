import type { ReactNode } from "react";

// Loading placeholders shaped like the content they stand in for, used for
// anything that takes more than ~300 ms instead of a bare spinner. A shimmer
// that stops for reduced-motion users (metis-ui.css).

export function SkeletonLine({ width = "100%", height = 12 }: { width?: number | string; height?: number }) {
  return <span className="m-skel" style={{ width, height }} aria-hidden />;
}

/** A card: optional heading line, then `lines` body lines. */
export function SkeletonCard({ lines = 3, heading = true }: { lines?: number; heading?: boolean }) {
  return (
    <div className="m-skel-card" aria-hidden>
      {heading && <SkeletonLine width="40%" height={16} />}
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? "70%" : "100%"} />
      ))}
    </div>
  );
}

/** A row: a small badge, a label, and a value on the right. */
export function SkeletonRow() {
  return (
    <div className="m-skel-row" aria-hidden>
      <SkeletonLine width={28} height={28} />
      <SkeletonLine width="45%" />
      <SkeletonLine width={64} />
    </div>
  );
}

/** Announces loading to assistive tech while the shapes show. */
export function SkeletonRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="m-skel-region" role="status" aria-live="polite" aria-busy="true">
      <span className="m-sr-only">{label}</span>
      {children}
    </div>
  );
}
