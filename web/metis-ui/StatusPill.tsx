// A status pill: a glyph and a word, tinted by tone. The word carries the
// meaning; the color only reinforces it.

export type PillTone = "good" | "warn" | "bad" | "info" | "neutral";

const DEFAULT_GLYPH: Record<PillTone, string> = { good: "✓", warn: "▲", bad: "✕", info: "●", neutral: "○" };

export interface StatusPillProps {
  tone: PillTone;
  label: string;
  glyph?: string;
}

export function StatusPill({ tone, label, glyph }: StatusPillProps) {
  return (
    <span className={`m-pill m-pill-${tone}`}>
      <span aria-hidden>{glyph ?? DEFAULT_GLYPH[tone]}</span> {label}
    </span>
  );
}
