// One number format for every Metis product (P2: "$1.19M, 3.33x, 56%, with
// one decimal rule"). Render the results in tabular figures (.m-num).
//
// The rule: money and multiples keep 2 decimals when short-scaled or a
// ratio; percentages are whole numbers unless under 10 (then 1 decimal);
// confidence is always a whole percentage, never 0.55.

const DASH = "—";
const bad = (n: number | null | undefined): n is null | undefined => n === null || n === undefined || Number.isNaN(n);

/** $1.19M, $845K, $940, −$1.2M */
export function money(n: number | null | undefined): string {
  if (bad(n)) return DASH;
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const trim = (s: string) => s.replace(/\.?0+$/, "");
  if (a >= 1e9) return `${sign}$${trim((a / 1e9).toFixed(2))}B`;
  if (a >= 1e6) return `${sign}$${trim((a / 1e6).toFixed(2))}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** $1,190,000: when the exact figure matters (ledgers, tables). */
export function moneyExact(n: number | null | undefined): string {
  if (bad(n)) return DASH;
  return `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** 3.33x */
export function multiple(n: number | null | undefined): string {
  return bad(n) ? DASH : `${n.toFixed(2)}x`;
}

/** 56%, 4.8%, +12% with sign: true. Input is already a percentage. */
export function percent(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (bad(n)) return DASH;
  const digits = Math.abs(n) < 10 && n !== 0 && Math.round(n) !== n ? 1 : 0;
  const s = Math.abs(n).toFixed(digits);
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}${s}%`;
}

/** 0.55 -> "55%". Model confidence is shown as a whole percentage. */
export function confidence(fraction: number | null | undefined): string {
  return bad(fraction) ? DASH : `${Math.round(fraction * 100)}%`;
}
