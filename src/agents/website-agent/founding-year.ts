import { SearchProvider } from "../../lib/providers.js";

/**
 * Dedicated founding year extraction.
 * Uses targeted search queries against authoritative sources to get
 * the correct founding year, avoiding stale snippets.
 */
export async function extractFoundingYear(
  companyName: string,
  searcher: SearchProvider
): Promise<string | undefined> {
  const results = await searcher.search(
    `"${companyName}" founded year established wikipedia crunchbase`,
    3
  );

  // Look for year patterns in snippets
  const YEAR_PATTERN = /\b(19|20)\d{2}\b/g;
  const yearCounts = new Map<string, number>();

  for (const r of results) {
    const text = `${r.title} ${r.snippet ?? ""}`;
    const years = text.match(YEAR_PATTERN) ?? [];
    for (const year of years) {
      const y = parseInt(year);
      // Only count plausible founding years (1900-current year)
      if (y >= 1900 && y <= new Date().getFullYear()) {
        yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      }
    }
  }

  if (yearCounts.size === 0) return undefined;

  // Return the most frequently mentioned year
  return Array.from(yearCounts.entries())
    .sort((a, b) => b[1] - a[1])[0][0];
}
