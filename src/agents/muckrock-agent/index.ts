import { FoiaRequestEntry, Source } from "../../types/research.js";

/**
 * MuckRock Agent (Round 3 — Jackal builds) — searches MuckRock's public
 * archive of filed FOIA/public-records requests for a name (person,
 * company, or political figure). MuckRock's API is free and keyless for
 * read access (www.muckrock.com/api_v1/), so this needs no new env var.
 *
 * Jackal-only (internal tier), same reasoning as opencorporates-agent —
 * this is a broad "search everything indexed for this exact name" pull,
 * not a default-tier feature.
 *
 * Surfaces existing FOIA requests *about* the subject (filed by
 * journalists/researchers), not a way to file a new request — this is a
 * discovery tool: "has anyone already gone digging on this person/org,
 * and what did they ask for."
 */

const MUCKROCK_BASE = "https://www.muckrock.com/api_v1";

interface MuckRockResult {
  title?: string;
  absolute_url?: string;
  status?: string;
  agency?: string | number;
  date_submitted?: string;
}

interface MuckRockSearchResponse {
  results?: MuckRockResult[];
}

export class MuckRockAgent {
  async run(query: string): Promise<{ requests: FoiaRequestEntry[]; sources: Source[] }> {
    try {
      const res = await fetch(
        `${MUCKROCK_BASE}/foia/?q=${encodeURIComponent(query)}&format=json&page_size=10`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[muckrock-agent] "${query}" — HTTP ${res.status}`);
        return { requests: [], sources: [] };
      }

      const data = (await res.json()) as MuckRockSearchResponse;
      const results = data.results ?? [];

      const requests: FoiaRequestEntry[] = results
        .filter((r) => r.title && r.absolute_url)
        .map((r) => ({
          title: r.title as string,
          url: r.absolute_url!.startsWith("http") ? r.absolute_url! : `https://www.muckrock.com${r.absolute_url}`,
          status: r.status,
          agency: typeof r.agency === "string" ? r.agency : undefined,
          dateSubmitted: r.date_submitted,
        }));

      const sources: Source[] = requests.length > 0
        ? [{
            url: `https://www.muckrock.com/search/?q=${encodeURIComponent(query)}`,
            title: `MuckRock FOIA archive — ${query}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["foia-requests"],
          }]
        : [];

      return { requests, sources };
    } catch (err) {
      console.warn(`[muckrock-agent] "${query}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { requests: [], sources: [] };
    }
  }
}
