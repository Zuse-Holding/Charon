import type { LeadershipEntry } from "../types/research.js";
import { normalizeWords } from "./news-noise.js";
import { sourceScore, sourceTier } from "./source-quality.js";

/**
 * Leadership clean-up after extraction (launch fixes 6, 7 and 9). Pure
 * code: one entry per person, one holder per exclusive title, and a
 * low-confidence mark on anyone only a scraped directory names.
 */

const CREDENTIAL = /\b(m\.?s|m\.?a|ph\.?d|m\.?d|bcba-?d?|lmft|lcsw|cpa|esq|mba|jr|sr|ii|iii)\b\.?/gi;

/** "Dr. Lilia Agadganian, M.S., BCBA" -> "lilia agadganian". */
export function personKey(name: string): string {
  const words = normalizeWords(name.replace(/^dr\.?\s+/i, "").replace(CREDENTIAL, " ")).trim().split(" ").filter(Boolean);
  // First and last name: a middle initial or name doesn't make two people.
  return words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : words.join(" ");
}

/** Titles split into roles: "President and CEO" -> ["President", "CEO"]. */
function roles(title: string): string[] {
  return title.split(/\s*(?:,|&|\/|\band\b|;)\s*/i).map((r) => r.trim()).filter(Boolean);
}

function mergeTitles(a: string, b: string): string {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (!b || la.includes(lb) || lb === "unknown") return a;
  if (!a || lb.includes(la) || la === "unknown") return b;
  const merged = [...roles(a)];
  for (const r of roles(b)) if (!merged.some((m) => m.toLowerCase() === r.toLowerCase())) merged.push(r);
  return merged.join(", ");
}

/** One entry per person: titles merged, the best-sourced URL kept. */
export function dedupeLeadership(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  const out: LeadershipEntry[] = [];
  const byKey = new Map<string, LeadershipEntry>();
  for (const e of entries) {
    const key = personKey(e.name);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      const copy = { ...e };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    prev.title = mergeTitles(prev.title, e.title);
    if (!prev.bio && e.bio) prev.bio = e.bio;
    const score = (u?: string) => (u ? sourceScore(u, subjectDomain) : -1);
    if (score(e.sourceUrl) > score(prev.sourceUrl)) {
      prev.sourceUrl = e.sourceUrl;
      prev.asOf = e.asOf ?? prev.asOf;
    }
    // The fuller spelling of the name wins ("Lilia Agadganian, BCBA" over "Lilia").
    if (e.name.length > prev.name.length && personKey(e.name) === key) prev.name = e.name;
  }
  return out;
}

// One person holds each of these at a time.
const EXCLUSIVE: { label: string; re: RegExp }[] = [
  { label: "CEO", re: /^(ceo|chief executive( officer)?)$/i },
  { label: "President", re: /^president$/i },
  { label: "Chair", re: /^(chair(man|woman|person)?( of the board)?|executive chair(man)?)$/i },
  { label: "CFO", re: /^(cfo|chief financial officer)$/i },
  { label: "COO", re: /^(coo|chief operating officer)$/i },
  { label: "CTO", re: /^(cto|chief technology officer)$/i },
];

/** Newer first, then the company's own site over anything else. */
function newer(a: LeadershipEntry, b: LeadershipEntry, subjectDomain?: string): boolean {
  const ta = a.asOf ? Date.parse(a.asOf) : NaN;
  const tb = b.asOf ? Date.parse(b.asOf) : NaN;
  if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return ta > tb;
  if (!isNaN(ta) !== !isNaN(tb)) return !isNaN(ta);
  const sa = a.sourceUrl ? sourceScore(a.sourceUrl, subjectDomain) : 0;
  const sb = b.sourceUrl ? sourceScore(b.sourceUrl, subjectDomain) : 0;
  return sa > sb;
}

/**
 * Two people listed with the same exclusive title: the newest primary
 * source keeps it; the other keeps their remaining titles and is marked
 * possibly outdated for that one (Oct 2026: Darway president, Marrs CEO
 * and chair, where an older page had Marrs as "President and CEO").
 */
export function resolveTitleConflicts(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  for (const { label, re } of EXCLUSIVE) {
    const holders = entries.filter((e) => roles(e.title).some((r) => re.test(r)));
    if (holders.length < 2) continue;
    const winner = holders.reduce((best, e) => (newer(e, best, subjectDomain) ? e : best));
    for (const e of holders) {
      if (e === winner) continue;
      const rest = roles(e.title).filter((r) => !re.test(r));
      if (rest.length) e.title = rest.join(" and ");
      e.outdatedTitles = [...(e.outdatedTitles ?? []), label];
    }
  }
  return entries;
}

/** Named only by a scraped people directory (RocketReach, Comparably...). */
export function markDirectoryOnly(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  for (const e of entries) {
    if (e.sourceUrl && sourceTier(e.sourceUrl, subjectDomain) === "directory") e.lowConfidence = true;
  }
  return entries;
}

export function cleanLeadership(entries: LeadershipEntry[], subjectDomain?: string): LeadershipEntry[] {
  return markDirectoryOnly(resolveTitleConflicts(dedupeLeadership(entries, subjectDomain), subjectDomain), subjectDomain);
}

const TITLE = "(?:co-?founder(?:\\s+(?:and|&)\\s+(?:ceo|president|cto|chief [a-z]+ officer))?|founder|chief [a-z]+ officer|ceo|cto|coo|cfo|president|chair(?:man|woman)?|managing (?:director|partner)|vice president(?: of [a-z ]{3,30})?|head of [a-z ]{3,30}|general counsel)";

/**
 * A title the pages give next to the name ("Jake Loosararian, CEO", "CEO
 * Jake Loosararian") for an entry extracted without one (launch fix 32).
 */
export function titleNear(name: string, texts: string[]): string | undefined {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const after = new RegExp(`${n}\\s*(?:,|-|–|—|\\(|\\bis\\b|\\bas\\b)?\\s*(?:the\\s+|our\\s+)?(${TITLE})\\b`, "i");
  const before = new RegExp(`\\b(${TITLE})\\s*(?:,|-|–|—|:)?\\s*${n}`, "i");
  for (const t of texts) {
    const m = t.match(after) ?? t.match(before);
    if (m) return m[1].replace(/\b(ceo|cto|coo|cfo)\b/gi, (x) => x.toUpperCase()).replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Of|And)\b/g, (x) => x.toLowerCase());
  }
  return undefined;
}
