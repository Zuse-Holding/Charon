import { FoiaRequestEntry, Source } from "../../types/research.js";

/**
 * MuckRock Agent (Round 3 — Charon builds) — searches MuckRock's public
 * archive of filed FOIA/public-records requests for a name (person,
 * company, or political figure).
 *
 * AUTH HISTORY (getting this right took four tries — documenting so a
 * future pass doesn't repeat them):
 *   1. Assumed keyless. Wrong — HTTP 401 in production.
 *   2. Switched to MuckRock's Squarelet OAuth2 (username/password ->
 *      short-lived access token via accounts.muckrock.com), sent as
 *      `Authorization: Bearer <token>` against `api_v1/foia/`. Login
 *      succeeded, but the request itself still 401'd — confirmed in
 *      production logs.
 *   3. Tried a plain, non-expiring per-account API key against
 *      `api_v1/foia/` instead (`Authorization: Token <key>`), per
 *      MuckRock's own now-outdated API-examples repo. Turned out MuckRock
 *      no longer issues these — nothing in account settings to generate
 *      one anymore.
 *   4. Root cause, confirmed by reading MuckRock's actual source
 *      (github.com/MuckRock/muckrock, muckrock/foia/api_v2/viewsets.py +
 *      muckrock/core/views.py): `api_v1` is a legacy API that predates
 *      Squarelet entirely and was never wired to accept OAuth tokens —
 *      there's no version of "Token <key>" that still works against it.
 *      `api_v2`'s FOIARequestViewSet uses `AuthenticatedAPIMixin`, whose
 *      `authentication_classes = [JWTAuthentication, SessionAuthentication]`
 *      — it *only* accepts a Squarelet-issued JWT Bearer token (RS256,
 *      matches SIMPLE_JWT in muckrock/settings/base.py), never a static
 *      key. So step 2's Bearer-token approach was the right auth scheme
 *      all along — it just needed to hit `api_v2/requests/`, not
 *      `api_v1/foia/`. That's the fix: same OAuth login flow as before,
 *      pointed at the right base URL and resource.
 *
 * Charon-only (internal tier), same reasoning as opencorporates-agent —
 * this is a broad "search everything indexed for this exact name" pull,
 * not a default-tier feature.
 *
 * Surfaces existing FOIA requests *about* the subject (filed by
 * journalists/researchers), not a way to file a new request — this is a
 * discovery tool: "has anyone already gone digging on this person/org,
 * and what did they ask for."
 */

const MUCKROCK_AUTH_BASE = "https://accounts.muckrock.com/api";
const MUCKROCK_API_BASE = "https://www.muckrock.com/api_v2";

interface MuckRockRequestResult {
  id?: number;
  title?: string;
  status?: string;
  datetime_submitted?: string;
}

interface MuckRockSearchResponse {
  results?: MuckRockRequestResult[];
}

// Module-level cache — access tokens are valid 5 minutes regardless of
// which MuckRockAgent instance requested one, so sharing across the
// process avoids a redundant login call.
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
      console.warn(`[muckrock-agent] login HTTP ${res.status} — check MUCKROCK_USERNAME/MUCKROCK_PASSWORD`);
      return null;
    }

    const data = (await res.json()) as { access?: string };
    if (!data.access) {
      console.warn(`[muckrock-agent] login succeeded but response had no access token`);
      return null;
    }

    cachedAccessToken = data.access;
    cachedTokenExpiresAt = now + 4 * 60 * 1000;
    return cachedAccessToken;
  } catch (err) {
    console.warn(`[muckrock-agent] login request failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export class MuckRockAgent {
  async run(query: string): Promise<{ requests: FoiaRequestEntry[]; sources: Source[] }> {
    const token = await getAccessToken();
    if (!token) return { requests: [], sources: [] };

    try {
      const res = await fetch(
        `${MUCKROCK_API_BASE}/requests/?search=${encodeURIComponent(query)}&page_size=10`,
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

      // No "agency" name in the v2 response (just a numeric agency ID) —
      // omit rather than show an unhelpful raw ID. /foi/<id>/ is a
      // confirmed-stable MuckRock shortlink that redirects to the real
      // slugged URL, so this works without needing the request's slug or
      // jurisdiction.
      const requests: FoiaRequestEntry[] = results
        .filter((r) => r.title && r.id)
        .map((r) => ({
          title: r.title as string,
          url: `https://www.muckrock.com/foi/${r.id}/`,
          status: r.status,
          dateSubmitted: r.datetime_submitted,
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
