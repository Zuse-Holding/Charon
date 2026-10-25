import { isNewsNoise } from "./news-noise.js";
/**
 * Acquisitions, subsidiaries and brands a company's news and own pages
 * state (launch fix 80: ChatGPT listed Andersen's Bright Wood and
 * Minnesota Weatherization Specialists acquisitions and its Renewal by
 * Andersen brand; Metis showed none).
 */

export interface CorporateAction {
  kind: "Acquisition" | "Subsidiary or brand";
  name: string;
  date?: string;
  url: string;
  /** Brought forward from an earlier run (round 16). */
  carried?: boolean;
}

const NAME = "([A-Z0-9][\\w&'’.-]*(?:\\s+(?:[A-Z0-9][\\w&'’.-]*|of|and|&|by)){0,5})";
const SUFFIX = "(?:,?\\s+(?:Inc\\.?|LLC|Corp\\.?|Corporation|Co\\.?|Company|Holdings))?";
const TRAILING = /\s+(?:of|and|&|by)$/i;

/** @param names The company's name and short names ("Graybar" for Graybar Electric Company). */
export function corporateActions(items: { text: string; url: string; date?: string }[], names: string[]): CorporateAction[] {
  const cores = [...new Set(names.map((x) => x.replace(/,?\s+(inc\.?|llc|corp\.?|corporation|co\.?|company|ltd\.?)$/i, "").trim()).filter((x) => x.length >= 3))];
  if (!cores.length) return [];
  const n = `(?:${cores.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|")})`;
  const bought = new RegExp(`\\b${n}${SUFFIX}(?:['’]s)?\\s+(?:has\\s+|to\\s+|will\\s+)?(?:acquires|acquired|buys|bought|completes\\s+(?:the\\s+|its\\s+)?acquisition\\s+of|agrees\\s+to\\s+acquire|announces\\s+(?:the\\s+)?acquisition\\s+of)\\s+${NAME}`, "g");
  const unit = new RegExp(`${NAME},?\\s+(?:a|an|the)\\s+(?:wholly[- ]owned\\s+)?(?:subsidiary|division|brand|business unit|company)\\s+of\\s+${n}\\b`, "g");
  const out: CorporateAction[] = [];
  const seen = new Set<string>();
  const add = (kind: CorporateAction["kind"], raw: string, it: { url: string; date?: string }) => {
    // "Pioneer Power. Limbach Company. 1y" is "Pioneer Power" (round 13).
    const name = raw.split(/\.\s/)[0].replace(TRAILING, "").replace(/[.,]$/, "").trim();
    const key = name.toLowerCase();
    // Never the company itself, and never a bare generic word.
    if (!name || name.split(/\s+/).length > 6 || cores.some((c) => key === c.toLowerCase()) || /^(the|its|a|an|company|business)$/i.test(name) || seen.has(key)) return;
    seen.add(key);
    out.push({ kind, name, date: it.date, url: it.url });
  };
  for (const it of items) {
    // A social post isn't a record of a deal (round 13: MJW's "Atlanta"
    // acquisition came from a Facebook post).
    if (/^https?:\/\//i.test(it.url) && isNewsNoise(it.url)) continue;
    // "Pioneer Power and 1901 Group" is two.
    for (const m of it.text.matchAll(bought)) for (const part of m[1].split(/\s+and\s+/)) add("Acquisition", part, it);
    for (const m of it.text.matchAll(unit)) add("Subsidiary or brand", m[1], it);
  }
  return out;
}
