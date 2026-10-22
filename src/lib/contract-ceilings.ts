import type { FederalSpendingEntry, NewsEntry } from "../types/research.js";
import { parseMoney } from "./consistency.js";

/**
 * Ceiling versus obligated (launch fix 28): a contract announced at "$300M"
 * is a ceiling; USAspending shows what's actually been obligated. When news
 * names an agency the company has awards from and a dollar figure well above
 * what that agency has obligated, the report says both.
 */
export interface ContractCeiling {
  agency: string;
  /** "$300M" as announced. */
  ceiling: number;
  /** Sum of award amounts from that agency on USAspending. */
  obligated: number;
  newsUrl?: string;
  newsDate?: string;
}

// Words news uses for an agency, and how USAspending names it.
const AGENCIES: { label: string; news: RegExp; spending: RegExp }[] = [
  { label: "Navy", news: /\b(navy|naval|navsea|navair)\b/i, spending: /navy|naval/i },
  { label: "Army", news: /\barmy\b/i, spending: /army/i },
  { label: "Air Force", news: /\b(air force|usaf)\b/i, spending: /air force/i },
  { label: "Coast Guard", news: /\bcoast guard\b/i, spending: /coast guard|homeland security/i },
  { label: "GSA", news: /\b(gsa|general services administration)\b/i, spending: /general services/i },
  { label: "Department of Defense", news: /\b(pentagon|department of defense|dod)\b/i, spending: /defense/i },
  { label: "Department of Transportation", news: /\b(department of transportation|dot|faa)\b/i, spending: /transportation|aviation/i },
  { label: "Social Security Administration", news: /\b(social security administration|ssa)\b/i, spending: /social security/i },
  { label: "Department of Veterans Affairs", news: /\b(veterans affairs|the va)\b/i, spending: /veterans/i },
  { label: "NASA", news: /\bnasa\b/i, spending: /aeronautics|nasa/i },
  { label: "Department of Energy", news: /\b(department of energy|doe)\b/i, spending: /energy/i },
];

const CONTRACT_WORDS = /\b(contract|award|ceiling|idiq|agreement|task order|deal)\b/i;

export function contractCeilings(awards: FederalSpendingEntry[], news: NewsEntry[]): ContractCeiling[] {
  const out: ContractCeiling[] = [];
  for (const a of AGENCIES) {
    const obligated = awards
      .filter((w) => a.spending.test(w.awardingAgency ?? ""))
      .reduce((sum, w) => sum + (parseMoney(w.amount ?? "")[0] ?? 0), 0);
    if (obligated <= 0) continue;
    for (const n of news) {
      const text = `${n.headline}. ${n.summary ?? ""}`;
      if (!a.news.test(text) || !CONTRACT_WORDS.test(text)) continue;
      const ceiling = Math.max(0, ...parseMoney(text));
      // Well above what's been obligated: an announced ceiling, not spend.
      if (ceiling >= obligated * 3 && ceiling >= 1e6) {
        out.push({ agency: a.label, ceiling, obligated, newsUrl: n.url, newsDate: n.date });
        break;
      }
    }
  }
  return out;
}
