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

/** Large or repeated selling by one insider, and selling by several at once. */
export function insiderSelling(entries: Form4Entry[]): InsiderSellingFact[] {
  const sellers = new Map<string, Form4Entry[]>();
  for (const e of entries) {
    if (!SELL.test(e.transactionType ?? "")) continue;
    const key = tidyName(e.filerName).toLowerCase();
    sellers.set(key, [...(sellers.get(key) ?? []), e]);
  }
  const out: InsiderSellingFact[] = [];
  const notable: string[] = [];
  for (const sales of sellers.values()) {
    const total = sales.reduce((sum, s) => sum + (parseMoney(s.value ?? "")[0] ?? 0), 0);
    if (sales.length < MIN_SALES && total < MIN_TOTAL) continue;
    const name = tidyName(sales[0].filerName);
    notable.push(name);
    const dates = sales.map((s) => s.date).filter((d): d is string => !!d).sort((a, b) => Date.parse(a) - Date.parse(b));
    const span = dates.length ? ` (${dates[0]}${dates.length > 1 && dates[dates.length - 1] !== dates[0] ? ` to ${dates[dates.length - 1]}` : ""})` : "";
    const rel = sales[0].relationship ? ` (${sales[0].relationship})` : "";
    out.push({
      text: `Insider selling: ${name}${rel} sold ${total ? `about ${fmt(total)} ` : ""}in ${sales.length} sale${sales.length === 1 ? "" : "s"}${span}`,
      url: sales.find((s) => s.filingUrl)?.filingUrl,
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
