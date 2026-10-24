import type { ResearchBundle } from "../types/research.js";
import { seniority } from "./leadership.js";

/**
 * A plain executive summary built from the report's own facts (round 12).
 * The model's summary is dropped when it can't cite a fact or copies the
 * site's tagline, which left most reports opening with the tagline. This
 * one states only what the report already shows: what it does, when and
 * where it started, who leads it, its scale, and its latest development.
 */

const CHIEF = /\b(ceo|chief executive|co-ceo|president|executive director|managing partner)\b/i;
const NOT_CHIEF = /\bvice[- ]president\b|\bvp\b/i;

const lc = (s: string) => (/^(A\s|[A-Z][a-z])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const trimEnd = (s: string) => s.trim().replace(/[.;,\s]+$/, "");

function money(v: number): string {
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
}

/**
 * "Provides X" -> "Promise ABA provides X"; "A real estate firm" -> "MJW
 * Investments is a real estate firm"; "Distributor of X" -> "Graybar is a
 * distributor of X"; "Limbach provides X" stays as written.
 */
export function whatItDoes(name: string, description?: string): string | undefined {
  const d = description ? trimEnd(description.split(/(?<=[.!?])\s+/)[0]) : "";
  if (!d) return undefined;
  // Already names the company, in full or by its first word.
  const first = name.split(/\s+/)[0].toLowerCase();
  if (d.toLowerCase().startsWith(name.toLowerCase()) || (first.length >= 4 && d.toLowerCase().startsWith(first))) return `${d}.`;
  if (/^(a|an|the)\s/i.test(d)) return `${name} is ${lc(d)}.`;
  if (/^[A-Z][a-z]+s\b/.test(d)) return `${name} ${lc(d)}.`;
  // A noun phrase: "Distributor of ...", "Leader in ...".
  if (/^[A-Z][a-z]+\s+(of|in|for|and)\b/.test(d)) return `${name} is ${/^[AEIOU]/.test(d) ? "an" : "a"} ${d[0].toLowerCase()}${d.slice(1)}.`;
  return `${name}: ${d}.`;
}

/** A headline fit to quote: no " | Outlet" tail, not cut off mid-sentence. */
export function quotableHeadline(h: string): string | undefined {
  const t = trimEnd(h.replace(/\s+[|–—-]\s+[^|–—-]{2,60}$/, "").replace(/\s*\|\s*.*$/, ""));
  if (/(\.\.\.|…)\s*$/.test(h.trim()) || t.split(/\s+/).length < 4) return undefined;
  // Ends on a word that can't end a headline ("Strong Impact on").
  if (/\b(on|of|in|to|for|and|the|a|an|with|at|by|from)$/i.test(t)) return undefined;
  return t;
}

export function composeSummary(bundle: ResearchBundle, now = Date.now()): string | undefined {
  const c = bundle.company;
  const parts: string[] = [];
  const first = whatItDoes(c.name, c.description);
  if (first) parts.push(first);

  const origin = [c.founded && `Founded in ${c.founded}`, c.headquarters && !c.headquartersUnverified && `based in ${c.headquarters}`].filter(Boolean) as string[];
  if (origin.length) parts.push(`${origin.join(" and ").replace(/^based/, "Based")}.`);

  const chiefs = bundle.leadership.filter((l) => !l.lowConfidence && CHIEF.test(l.title) && !NOT_CHIEF.test(l.title))
    .sort((a, b) => seniority(a.title) - seniority(b.title)).slice(0, 2);
  if (chiefs.length) parts.push(`Led by ${chiefs.map((l) => `${l.name} (${l.title})`).join(" and ")}.`);

  // Scale: filed revenue, 990 revenue, the latest rounds, or ownership.
  const fin = bundle.secFilings?.financials?.filter((y) => y.revenue !== undefined).sort((a, b) => b.year.localeCompare(a.year))[0];
  const np = bundle.nonprofitFinancials?.years?.filter((y) => y.revenue !== undefined).sort((a, b) => b.year.localeCompare(a.year))[0];
  if (fin) parts.push(`Revenue was ${money(fin.revenue!)} in FY${fin.year}.`);
  else if (np) parts.push(`A nonprofit with ${money(np.revenue!)} in revenue (${np.year} Form 990).`);
  else if (bundle.funding.length) {
    const rounds = bundle.funding.filter((f) => f.round && f.amount && !/\(target\)$/.test(f.round)).slice(0, 2);
    const target = bundle.funding.find((f) => /\(target\)$/.test(f.round ?? ""));
    if (rounds.length) parts.push(`Funding on record includes ${rounds.map((f) => `${f.round} (${f.amount}${f.date ? `, ${f.date}` : ""})`).join(" and ")}.`);
    else if (target) parts.push(`It is raising a fund with a ${target.amount} target.`);
  }
  if (bundle.ownership) parts.push(`${bundle.ownership.replace(/^Owned by/, "It is owned by")}.`.replace(/\.\.$/, "."));
  if ((c.locations?.length ?? 0) >= 3) parts.push(`It lists ${c.locations!.length} locations, including ${c.locations!.slice(0, 3).join(", ")}.`);

  // The latest development: an acquisition, or the newest dated news item.
  const action = (bundle.corporateActions ?? []).filter((a) => a.kind === "Acquisition" && a.date && Date.parse(a.date) >= now - 2 * 365 * 86_400_000)[0];
  const news = bundle.news.filter((n) => n.date && !n.solicitation && Date.parse(n.date) >= now - 180 * 86_400_000 && quotableHeadline(n.headline))
    .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!))[0];
  if (action) parts.push(`It acquired ${action.name} (${action.date}).`);
  else if (news) parts.push(`Most recent coverage: "${quotableHeadline(news.headline)}" (${news.date}).`);

  // Only worth showing if it says more than the tagline.
  return parts.length >= 3 ? parts.join(" ") : undefined;
}
