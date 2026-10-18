import type { ReactNode } from "react";

// Every non-happy state on every Metis site goes through this: loading,
// empty, error, partial, quota and upgrade. The props are the contract from
// the UX doc: what happened, what you can do, and when it changes. Each kind
// carries a glyph and a word, never color alone.

export type StateKind = "loading" | "empty" | "error" | "partial" | "quota" | "upgrade";

export interface StateViewProps {
  kind: StateKind;
  /** What happened, in one plain sentence. Required. */
  what: string;
  /** What the person can do now: a button, a link, or a sentence. Required. */
  action: ReactNode;
  /** When this changes on its own ("Resets Nov 1", "Usually under a minute").
   *  Pass null only when nothing will change without the person acting. */
  when: string | null;
  /** Optional detail under the main line (e.g. which sources failed). */
  detail?: ReactNode;
  compact?: boolean;
}

const KIND: Record<StateKind, { glyph: string; label: string }> = {
  loading: { glyph: "◌", label: "Working" },
  empty: { glyph: "○", label: "Nothing here yet" },
  error: { glyph: "✕", label: "Something went wrong" },
  partial: { glyph: "◐", label: "Partly done" },
  quota: { glyph: "■", label: "Limit reached" },
  upgrade: { glyph: "▲", label: "Available on a higher plan" },
};

export function StateView({ kind, what, action, when, detail, compact = false }: StateViewProps) {
  const k = KIND[kind];
  return (
    <div
      className={`m-state m-state-${kind}${compact ? " m-state-compact" : ""}`}
      role={kind === "error" || kind === "quota" ? "alert" : kind === "loading" ? "status" : undefined}
      aria-busy={kind === "loading" || undefined}
    >
      <div className="m-state-head">
        <span className="m-state-glyph" aria-hidden>{k.glyph}</span>
        <span className="m-state-label">{k.label}</span>
      </div>
      <p className="m-state-what">{what}</p>
      {detail && <div className="m-state-detail">{detail}</div>}
      <div className="m-state-action">{action}</div>
      {when && <p className="m-state-when">{when}</p>}
    </div>
  );
}
