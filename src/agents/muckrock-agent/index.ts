import { FoiaRequestEntry, Source } from "../../types/research.js";

/**
 * MuckRock Agent (Round 3 — Jackal builds) — searches MuckRock's public
 * archive of filed FOIA/public-records requests for a name (person,
 * company, or political figure).
 *
 * CORRECTION (round 2 of getting this right): first version assumed the
 * API was keyless — wrong, got HTTP 401 in production. Checked
 * MuckRock's actual docs afterward: auth is OAuth2-style via
 * accounts.muckrock.com, not a static API key. POST username/password to
 * /api/token/ to get an {access, refresh} pair; the access token expires
 * after 5 minutes, and refresh tokens rotate (each use invalidates the
 * old one and issues a new one) — so there's no stable token to just
 * paste into an env var. The one thing that *is* stable is your
 * username/password, so that's what this reads (MUCKROCK_USERNAME /
 * MUCKROCK_PASSWORD), logging in fresh to get a short-lived access token
 * and caching it in memory for a few minutes to avoid re-authenticating
 * on every call within the same process.
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

const MUCKROCK_AUTH_BASE = "https://accounts.muckrock.com/api";
const MUCKROCK_API_BASE = "https://www.muckrock.com/api_v1";

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

// Module-level cache (not per-instance) — access tokens are valid 5
// minutes regardless of which MuckRockAgent instance requested one, so
// sharing across the process avoids a redundant login call on every
// research run.
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && now < cachedTokenExpiresAt) return cachedAccessToken;

  const username = process.env.MUCKROCK_USERNAME;
  const password = process.env.MUCKROCK_PASSWORD;
  if (!username || !password) return null;

  try {
    const res = await fetch(`${MUCKROCK_AUTH_BASE}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[muckrock-agent] auth HTTP ${res.status} — check MUCKROCK_USERNAME/MUCKROCK_PASSWORD`);
      return null;
    }

    const data = (await res.json()) as { access?: string };
    if (!data.access) {
      console.warn(`[muckrock-agent] auth succeeded but response had no access token`);
      return null;
    }

    cachedAccessToken = data.access;
    // Real expiry is 5 minutes; cache for 4 to leave a safety margin.
    cachedTokenExpiresAt = now + 4 * 60 * 1000;
    return cachedAccessToken;
  } catch (err) {
    console.warn(`[muckrock-agent] auth request failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export class MuckRockAgent {
  async run(query: string): Promise<{ requests: FoiaRequestEntry[]; sources: Source[] }> {
    const token = await getAccessToken();
    if (!token) return { requests: [], sources: [] };

    try {
      const res = await fetch(
        `${MUCKROCK_API_BASE}/foia/?q=${encodeURIComponent(query)}&format=json&page_size=10`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        }
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

      console.log(`[muckrock-agent] "${query}" — ${requests.length} FOIA request(s) found`);

      return { requests, sources };
    } catch (err) {
      console.warn(`[muckrock-agent] "${query}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { requests: [], sources: [] };
    }
  }
}
