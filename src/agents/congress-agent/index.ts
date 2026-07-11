import { SponsoredBillEntry, Source } from "../../types/research.js";
import { SearchProvider } from "../../lib/providers.js";

/**
 * Congress.gov Agent (Round 2 v2) — real voting/legislative data from the
 * official Library of Congress API (api.congress.gov). Replaces
 * ProPublica's Congress API, which was shut down — this is the current
 * authoritative free source for member and bill data.
 *
 * Requires CONGRESS_API_KEY (free, instant signup at api.congress.gov).
 * Federal members of Congress only (House + Senate) — doesn't cover
 * governors, state legislators, or other officials (see legiscan-agent
 * for state-level coverage).
 *
 * api.congress.gov has no name-search endpoint for members, so this
 * resolves a bioguide ID (the stable member identifier, e.g. "S000344")
 * via a web search for the person's congress.gov member page and a
 * regex against the URL pattern /member/{slug}/{bioguideId}. Once
 * resolved, member profile + sponsored-legislation are real API calls.
 *
 * NOTE: the exact shape of /member/{bioguideId}'s response (nested
 * partyHistory/terms structure) is based on documented API behavior but
 * hasn't been verified against a live call from this environment
 * (network to api.congress.gov isn't reachable from the dev sandbox) —
 * every field access is defensive/optional so an unexpected shape
 * degrades to "field omitted," not a crash.
 */

const CONGRESS_BASE = "https://api.congress.gov/v3";

interface SponsoredLegislationItem {
  congress?: number;
  number?: string;
  type?: string;
  title?: string;
  introducedDate?: string;
  latestAction?: { text?: string; actionDate?: string };
  url?: string;
}

function extractBioguideId(text: string | undefined): string | null {
  if (!text) return null;
  // congress.gov member URLs look like .../member/brad-sherman/S000344
  const urlMatch = text.match(/\/member\/[a-z0-9-]+\/([A-Z]\d{6})/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  // Loose fallback: a bare bioguide-shaped token anywhere in the text.
  const bareMatch = text.match(/\b([A-Z]\d{6})\b/);
  return bareMatch ? bareMatch[1].toUpperCase() : null;
}

export class CongressAgent {
  private apiKey = process.env.CONGRESS_API_KEY;

  constructor(private searcher: SearchProvider) {}

  private async resolveBioguideId(name: string): Promise<string | null> {
    const results = await this.searcher.search(`${name} congress.gov member`, 5);
    for (const r of results) {
      const id = extractBioguideId(r.url) ?? extractBioguideId(r.snippet);
      if (id) return id;
    }
    return null;
  }

  async run(name: string): Promise<{
    sponsoredLegislation: SponsoredBillEntry[];
    office?: string;
    party?: string;
    state?: string;
    district?: string;
    sources: Source[];
  }> {
    if (!this.apiKey) return { sponsoredLegislation: [], sources: [] };

    try {
      const bioguideId = await this.resolveBioguideId(name);
      if (!bioguideId) {
        console.warn(`[congress-agent] "${name}" — could not resolve a bioguide ID (may not be a current member of Congress)`);
        return { sponsoredLegislation: [], sources: [] };
      }

      const [memberRes, sponsoredRes] = await Promise.all([
        fetch(`${CONGRESS_BASE}/member/${bioguideId}?api_key=${this.apiKey}&format=json`, {
          signal: AbortSignal.timeout(15_000),
        }).catch((err) => {
          console.warn(`[congress-agent] "${name}" (${bioguideId}) — member request failed:`, err instanceof Error ? err.message : err);
          return null;
        }),
        fetch(`${CONGRESS_BASE}/member/${bioguideId}/sponsored-legislation?api_key=${this.apiKey}&format=json&limit=10`, {
          signal: AbortSignal.timeout(15_000),
        }).catch((err) => {
          console.warn(`[congress-agent] "${name}" (${bioguideId}) — sponsored-legislation request failed:`, err instanceof Error ? err.message : err);
          return null;
        }),
      ]);

      let office: string | undefined;
      let party: string | undefined;
      let state: string | undefined;
      let district: string | undefined;

      if (memberRes?.ok) {
        const data = (await memberRes.json()) as Record<string, unknown>;
        const m = (data.member ?? data) as Record<string, unknown>;
        const partyHistory = m.partyHistory as Array<{ partyName?: string }> | undefined;
        // Confirmed in production: `terms` is a plain array of
        // {chamber, congress, startYear, ...} objects, not the
        // {item: [...]} wrapper assumed earlier. The most recent term
        // (last in the array — congress.gov returns them in ascending
        // order) tells us their current chamber.
        const terms = m.terms as Array<{ chamber?: string; congress?: number; startYear?: number }> | undefined;
        party = partyHistory?.[0]?.partyName ?? (m.currentParty as string | undefined);
        state = m.state as string | undefined;
        district = m.district !== undefined && m.district !== null ? String(m.district) : undefined;
        const latestTerm = terms?.length ? [...terms].sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0)).slice(-1)[0] : undefined;
        office = latestTerm?.chamber ?? (m.chamber as string | undefined);
      } else if (memberRes && !memberRes.ok) {
        console.warn(`[congress-agent] "${name}" (${bioguideId}) — member lookup HTTP ${memberRes.status}`);
      }

      let sponsoredLegislation: SponsoredBillEntry[] = [];
      if (sponsoredRes?.ok) {
        const data = (await sponsoredRes.json()) as { sponsoredLegislation?: SponsoredLegislationItem[] };
        sponsoredLegislation = (data.sponsoredLegislation ?? [])
          .filter((item) => item.title)
          .map((item) => ({
            billId: `${(item.type ?? "").toLowerCase()}${item.number ?? ""}-${item.congress ?? ""}`,
            title: item.title as string,
            congress: item.congress ? String(item.congress) : undefined,
            introducedDate: item.introducedDate,
            latestAction: item.latestAction?.text,
            latestActionDate: item.latestAction?.actionDate,
            url: item.url,
          }));
      } else if (sponsoredRes && !sponsoredRes.ok) {
        console.warn(`[congress-agent] "${name}" (${bioguideId}) — sponsored-legislation HTTP ${sponsoredRes.status}`);
      }

      const sources: Source[] = [{
        url: `https://www.congress.gov/member/${bioguideId}`,
        title: `Congress.gov — ${name}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["profile", "voting-record"],
      }];

      console.log(`[congress-agent] "${name}" (${bioguideId}) — resolved: office=${office ?? "?"} party=${party ?? "?"} state=${state ?? "?"} district=${district ?? "?"}, ${sponsoredLegislation.length} sponsored bill(s)`);

      return { sponsoredLegislation, office, party, state, district, sources };
    } catch (err) {
      console.warn(`[congress-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { sponsoredLegislation: [], sources: [] };
    }
  }
}
