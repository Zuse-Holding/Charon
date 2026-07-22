import { NonprofitFilingEntry, Source } from "../../types/research.js";

/**
 * ProPublica Nonprofit Explorer Agent (7/20 public-record fusion) — 990
 * filing lookup by name via ProPublica's free, keyless Nonprofit
 * Explorer API. Relevant to both company and person research: a company
 * might itself be a registered nonprofit (or have a nonprofit arm/
 * foundation), and a person's name search can surface nonprofits they're
 * listed as an officer/director of in the filing data.
 */

const NONPROFIT_BASE = "https://projects.propublica.org/nonprofits/api/v2";

interface NonprofitSearchResult {
  ein?: number;
  name?: string;
  ntee_code?: string;
  city?: string;
  state?: string;
}

interface NonprofitSearchResponse {
  organizations?: NonprofitSearchResult[];
}

export class ProPublicaNonprofitAgent {
  async run(name: string): Promise<{ organizations: NonprofitFilingEntry[]; sources: Source[] }> {
    try {
      const res = await fetch(
        `${NONPROFIT_BASE}/search.json?q=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        console.warn(`[propublica-nonprofit-agent] "${name}" — HTTP ${res.status}`);
        return { organizations: [], sources: [] };
      }

      const data = (await res.json()) as NonprofitSearchResponse;
      const results = data.organizations ?? [];

      const organizations: NonprofitFilingEntry[] = results
        .filter((r): r is NonprofitSearchResult & { ein: number; name: string } => Boolean(r.ein && r.name))
        .slice(0, 10)
        .map((r) => ({
          ein: String(r.ein).padStart(9, "0"),
          name: r.name,
          ntee: r.ntee_code,
          url: `https://projects.propublica.org/nonprofits/organizations/${r.ein}`,
        }));

      const sources: Source[] = organizations.length > 0
        ? [{
            url: `https://projects.propublica.org/nonprofits/search?q=${encodeURIComponent(name)}`,
            title: `ProPublica Nonprofit Explorer — ${name}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["nonprofit"],
          }]
        : [];

      console.log(`[propublica-nonprofit-agent] "${name}" — ${organizations.length} match(es)`);

      return { organizations, sources };
    } catch (err) {
      console.warn(`[propublica-nonprofit-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { organizations: [], sources: [] };
    }
  }
}
