// "3 of 25 profiles used · resets Nov 1": the one quota line for every Metis
// product (Intelligence limits today, Diligence packs later). Glyph + word
// for the state, never color alone.

import { quotaStatus, quotaText, type QuotaBadgeProps, type QuotaStatus } from "./quota";

export { quotaStatus, quotaText, type QuotaBadgeProps, type QuotaStatus };

const GLYPH: Record<QuotaStatus, string> = { ok: "●", warn: "▲", danger: "■" };
const WORD: Record<QuotaStatus, string> = { ok: "", warn: "Almost out · ", danger: "Limit reached · " };

export function QuotaBadge(props: QuotaBadgeProps) {
  const status = quotaStatus(props.used, props.limit, props.warnAt);
  return (
    <span className={`m-quota m-quota-${status}`}>
      <span aria-hidden>{GLYPH[status]}</span>
      <span className="m-num">{WORD[status]}{quotaText(props)}</span>
    </span>
  );
}
