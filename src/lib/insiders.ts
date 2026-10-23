import type { Form4Entry, LeadershipEntry } from "../types/research.js";
import { parseMoney } from "./consistency.js";

/**
 * Insider filings (Form 4) as risks and leadership (launch fix 83:
 * Limbach's CFO sold about $2.2M across five sales in March and April
 * 2026 and an EVP sold repeatedly, yet Risks said "No material risks";
 * the CFO was in Insider Activity but not in Leadership).
 */

const SELL = /\b(sell|sells|sold|sale|sales|disposition|disposed)\b/i;
const OFFICER = /\b(chief|ceo|cfo|coo|cto|president|vice president|evp|svp|general counsel|treasurer|secretary|controller)\b/i;
// One seller with this many sales, or this much sold, is worth a risk line.
const MIN_SALES = 3;
const MIN_TOTAL = 1_000_000;

const fmt = (v: number) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;

/** "BROOKS JAYME" -> "Brooks Jayme"; a mixed-case name is kept as written. */
const tidyName = (n: string) => (n === n.toUpperCase() ? n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : n).trim();

export interface InsiderSellingFact { text: string; url?: string; when?: string }

/**
 * Dollar value of one sale (round 10: Limbach's risk read "sold about $0K"
 * because the filings gave a per-share price, "$85.4269 per share", which
 * was summed as if it were the sale's value). A per-share price, or a
 * figure under $1,000 with a share count beside it, is multiplied out; a
 * price range uses its midpoint.
 */
export function saleValue(e: Pick<Form4Entry, "shares" | "value">): number {
  const prices = parseMoney(e.value ?? "");
  if (!prices.length) return 0;
  const shares = Number((e.shares ?? "").replace(/[^\d.]/g, ""));
  const perShare = /\bper\s+share\b|\/\s*share\b|\bat\s+\$/i.test(e.value ?? "") || (prices.every((p) => p < 1000) && shares > 0);
  if (!perShare) return prices[0];
  if (!(shares > 0)) return 0;
  const price = prices.length > 1 ? (Math.min(...prices) + Math.max(...prices)) / 2 : prices[0];
  return shares * price;
}

export const GENERIC_SEC_DOC = /sec\.gov\/(files|about|rules|forms)\//i;

/** Below this, a total is shown as shares only: it's a parse problem, not a sale size. */
const MIN_SHOWN_TOTAL = 10_000;

/** Large or repeated selling by one insider, and selling by several at once. */
export function insiderSelling(entries: Form4Entry[], now = Date.now()): InsiderSellingFact[] {
  const sellers = new Map<string, Form4Entry[]>();
  for (const e of entries) {
    if (!SELL.test(e.transactionType ?? "")) continue;
    // Sales in the last year: a full filing table goes back two (round 11).
    const t = e.date ? Date.parse(e.date) : NaN;
    if (!isNaN(t) && now - t > 365 * 86_400_000) continue;
    const key = tidyName(e.filerName).toLowerCase();
    sellers.set(key, [...(sellers.get(key) ?? []), e]);
  }
  const out: InsiderSellingFact[] = [];
  const notable: string[] = [];
  for (const sales of sellers.values()) {
    const total = sales.reduce((sum, s) => sum + saleValue(s), 0);
    const shares = sales.reduce((sum, s) => sum + (Number((s.shares ?? "").replace(/[^\d.]/g, "")) || 0), 0);
    if (sales.length < MIN_SALES && total < MIN_TOTAL) continue;
    const name = tidyName(sales[0].filerName);
    notable.push(name);
    const dates = sales.map((s) => s.date).filter((d): d is string => !!d).sort((a, b) => Date.parse(a) - Date.parse(b));
    const span = dates.length ? ` (${dates[0]}${dates.length > 1 && dates[dates.length - 1] !== dates[0] ? ` to ${dates[dates.length - 1]}` : ""})` : "";
    const rel = sales[0].relationship ? ` (${sales[0].relationship})` : "";
    out.push({
      text: `Insider selling: ${name}${rel} sold ${total >= MIN_SHOWN_TOTAL ? `about ${fmt(total)} ` : shares ? `${Math.round(shares).toLocaleString("en-US")} shares ` : ""}in ${sales.length} sale${sales.length === 1 ? "" : "s"}${span}`,
      // A filing, never SEC's generic Forms 3/4/5 instructions PDF.
      url: sales.find((s) => s.filingUrl && !GENERIC_SEC_DOC.test(s.filingUrl))?.filingUrl,
      when: dates[dates.length - 1],
    });
  }
  if (notable.length >= 2) out.unshift({ text: `Insider selling by ${notable.length} insiders: ${notable.join(", ")}`, url: out.find((o) => o.url)?.url, when: out[0]?.when });
  return out;
}

/** Officers the insider filings name, as leadership entries. */
export function officersFromFilings(entries: Form4Entry[]): LeadershipEntry[] {
  const out: LeadershipEntry[] = [];
  for (const e of entries) {
    if (!e.relationship || !OFFICER.test(e.relationship) || !e.filingUrl) continue;
    const name = tidyName(e.filerName);
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    const title = e.relationship.replace(/^(officer|director)\s*[:,(-]\s*/i, "").replace(/\)$/, "").trim();
    out.push({ name, title, sourceUrl: e.filingUrl, asOf: e.date });
  }
  return out;
}
