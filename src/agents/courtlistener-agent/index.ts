import { CourtListenerRecord, Source } from "../../types/research.js";

/**
 * CourtListener Agent (Charon Person Research) — searches CourtListener's
 * free public RECAP archive for federal litigation involving a name.
 * RECAP mirrors documents pulled from PACER by researchers/journalists —
 * there's no free PACER API itself (PACER requires a paid CM/ECF
 * account), so this is the closest real, no-cost source for "does this
 * person show up in federal court records."
 *
 * Auth is optional: CourtListener's v4 API works unauthenticated at a
 * lower rate limit, and even authenticated the limit is tiny (5 req/min,
 * 50/hr per CourtListener's own docs) — this must stay strictly
 * on-demand (the Person Research button), never added to an automatic
 * research path the way muckrock-agent's search is.
 *
 * Same fail-open-to-empty pattern as every other agent here — a bad
 * token, a rate limit, or a network error all just return no results
 * rather than throwing.
 */

const COURTLISTENER_BASE = "https://www.courtlistener.com/api/rest/v4";

interface CourtListenerSearchResult {
  caseName?: string;
  docket_absolute_url?: string;
  court?: string;
  dateFiled?: string;
  docketNumber?: string;
}

interface CourtListenerSearchResponse {
  results?: CourtListenerSearchResult[];
}

export class CourtListenerAgent {
  async run(name: string): Promise<{ records: CourtListenerRecord[]; sources: Source[] }> {
    const token = process.env.COURTLISTENER_API_TOKEN;
    const headers: Record<string, string> = token ? { Authorization: `Token ${token}` } : {};

    try {
      // type=r — RECAP (federal district court dockets), the closest
      // free mirror of PACER data.
      const res = await fetch(
        `${COURTLISTENER_BASE}/search/?q=${encodeURIComponent(name)}&type=r`,
        { headers, signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[courtlistener-agent] "${name}" — HTTP ${res.status}`);
        return { records: [], sources: [] };
      }

      const data = (await res.json()) as CourtListenerSearchResponse;
      const results = data.results ?? [];

      const records: CourtListenerRecord[] = results
        .filter((r) => r.caseName && r.docket_absolute_url)
        .slice(0, 10)
        .map((r) => ({
          caseName: r.caseName as string,
          url: `https://www.courtlistener.com${r.docket_absolute_url}`,
          court: r.court,
          dateFiled: r.dateFiled,
          docketNumber: r.docketNumber,
        }));

      const sources: Source[] = records.length > 0
        ? [{
            url: `https://www.courtlistener.com/?q=${encodeURIComponent(name)}&type=r`,
            title: `CourtListener RECAP search — ${name}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["court-records"],
          }]
        : [];

      console.log(`[courtlistener-agent] "${name}" — ${records.length} record(s) found`);

      return { records, sources };
    } catch (err) {
      console.warn(`[courtlistener-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { records: [], sources: [] };
    }
  }
}
