import { mentionsCompany, normalizeWords } from "./news-noise.js";

/**
 * Closed-business signals (Fix 4). Only unambiguous phrases: "closed" on
 * its own also means a funding round or a deal, so it never counts.
 */
const CLOSURE = /\b(permanently closed|closed permanently|closed for good|out of business|ceased operations|no longer in business|has shut down|shut its doors)\b/i;

// Community boards and social posts: one of these alone is a report, not
// confirmation (round 2, Fix 5).
const COMMUNITY_HOSTS = /(^|\.)(facebook|instagram|nextdoor|reddit|x|twitter|tiktok|threads)\.(com|net)$/i;

export interface TextItem { text: string; url: string }

export interface ClosureEvidence {
  evidence: string;
  url: string;
  /** Distinct sites saying it closed. */
  sources: number;
  /** Every source saying so is a community or social post. */
  communityOnly: boolean;
}

/** The quote around the match, starting and ending on whole words. */
function quote(text: string, at: number, length: number): string {
  const flat = text.replace(/\s+/g, " ");
  let start = Math.max(0, at - 120);
  let end = Math.min(flat.length, at + length + 120);
  if (start > 0) {
    const sentence = flat.lastIndexOf(". ", at);
    start = sentence >= start ? sentence + 2 : flat.indexOf(" ", start) + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > at + length) end = space;
  }
  const body = flat.slice(start, end).trim().replace(/[,;:]$/, "");
  return `${start > 0 && flat[start - 2] !== "." ? "…" : ""}${body}${end < flat.length ? "…" : ""}`;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return url; }
}

/** The first item that names this company (and the city, when one was
 *  given) and says it has closed, with how many sites say so. */
export function detectClosure(items: TextItem[], companyName: string, city?: string): ClosureEvidence | undefined {
  let first: { evidence: string; url: string } | undefined;
  const hosts = new Set<string>();
  for (const { text, url } of items) {
    const m = text.match(CLOSURE);
    if (!m || !mentionsCompany(text, companyName)) continue;
    if (city && !normalizeWords(text).includes(normalizeWords(city))) continue;
    hosts.add(hostOf(url));
    first ??= { evidence: quote(text, text.replace(/\s+/g, " ").search(CLOSURE), m[0].length), url };
  }
  if (!first) return undefined;
  return { ...first, sources: hosts.size, communityOnly: [...hosts].every((h) => COMMUNITY_HOSTS.test(h)) };
}

/** Folds a second check's findings into the first: same quote, more sources. */
export function mergeClosure(a: ClosureEvidence, items: TextItem[], companyName: string, city?: string): ClosureEvidence {
  const b = detectClosure([{ text: a.evidence, url: a.url }, ...items], companyName, city);
  return b ? { ...a, sources: Math.max(a.sources, b.sources), communityOnly: a.communityOnly && b.communityOnly } : a;
}

/** "Ventura, CA" -> "Ventura". */
export function cityOf(location: string | undefined): string | undefined {
  const city = location?.split(",")[0].trim();
  return city || undefined;
}
