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
  court_id?: string;
  suitNature?: string;
  cause?: string;
  dateTerminated?: string | null;
  docket_absolute_url?: string;
  court?: string;
  dateFiled?: string;
  docketNumber?: string;
}

interface CourtListenerSearchResponse {
  results?: CourtListenerSearchResult[];
  /** The next page's URL, when there is one. */
  next?: string | null;
}

export class CourtListenerAgent {
  /** @param pages Result pages to read (20 dockets each). Company reports
   *  read up to 3 (launch fix 30: one page missed Warner Records v. Crumbl). */
  async run(name: string, pages = 1): Promise<{ records: CourtListenerRecord[]; sources: Source[]; failed?: boolean }> {
    const token = process.env.COURTLISTENER_API_TOKEN;
    const headers: Record<string, string> = token ? { Authorization: `Token ${token}` } : {};

    try {
      // type=r — RECAP (federal district court dockets), the closest
      // free mirror of PACER data.
      const results: CourtListenerSearchResult[] = [];
      let url: string | null | undefined = `${COURTLISTENER_BASE}/search/?q=${encodeURIComponent(name)}&type=r`;
      // Launch fix 11 follow-up (MJW timed out): each page has its own
      // try, so a slow page 2 keeps page 1's results; the first page is
      // retried once; and paging stops at a 60s budget, inside the 90s the
      // coverage recorder allows.
      // Launch fix 56: pages 2 and 3 still timed out at 20s; each page now
      // gets up to 30s and a retry, inside a 75s budget.
      const deadline = Date.now() + 75_000;
      for (let page = 0; url && page < pages && Date.now() < deadline; page++) {
        let data: CourtListenerSearchResponse | undefined;
        for (let attempt = 0; attempt < 2 && !data && Date.now() < deadline; attempt++) {
          try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(Math.min(30_000, Math.max(1_000, deadline - Date.now()))) });
            if (!res.ok) {
              console.warn(`[courtlistener-agent] "${name}" — HTTP ${res.status} on page ${page + 1}`);
              if (res.status < 500) break;
              continue;
            }
            data = (await res.json()) as CourtListenerSearchResponse;
          } catch (err) {
            console.warn(`[courtlistener-agent] "${name}" — page ${page + 1} failed:`, err instanceof Error ? err.message : err);
          }
        }
        if (!data) {
          if (page === 0) throw new Error("CourtListener search failed after a retry");
          break;
        }
        results.push(...(data.results ?? []));
        url = data.next;
      }

      const records: CourtListenerRecord[] = results
        .filter((r) => r.caseName && r.docket_absolute_url)
        .slice(0, pages * 20)
        .map((r) => ({
          caseName: r.caseName as string,
          url: `https://www.courtlistener.com${r.docket_absolute_url}`,
          court: r.court,
          dateFiled: r.dateFiled,
          docketNumber: r.docketNumber,
          courtId: r.court_id,
          nature: r.suitNature || r.cause || undefined,
          dateTerminated: r.dateTerminated ?? undefined,
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
      return { records: [], sources: [], failed: true };
    }
  }
}
