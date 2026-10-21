import { mentionsCompany, normalizeWords } from "./news-noise.js";

/**
 * Closed-business signals (Fix 4). Only unambiguous phrases: "closed" on
 * its own also means a funding round or a deal, so it never counts.
 */
const CLOSURE = /\b(permanently closed|closed permanently|closed for good|out of business|ceased operations|no longer in business|has shut down|shut its doors)\b/i;

export interface TextItem { text: string; url: string }

/** The first item that names this company (and the city, when one was
 *  given) and says it has closed. */
export function detectClosure(items: TextItem[], companyName: string, city?: string): { evidence: string; url: string } | undefined {
  for (const { text, url } of items) {
    const m = text.match(CLOSURE);
    if (!m || !mentionsCompany(text, companyName)) continue;
    if (city && !normalizeWords(text).includes(normalizeWords(city))) continue;
    const at = m.index ?? 0;
    const evidence = text.slice(Math.max(0, at - 120), at + 120).replace(/\s+/g, " ").trim();
    return { evidence, url };
  }
  return undefined;
}

/** "Ventura, CA" -> "Ventura". */
export function cityOf(location: string | undefined): string | undefined {
  const city = location?.split(",")[0].trim();
  return city || undefined;
}
