import { FoiaRequestEntry, Source } from "../../types/research.js";

/**
 * MuckRock Agent (Round 3 — Jackal builds) — searches MuckRock's public
 * archive of filed FOIA/public-records requests for a name (person,
 * company, or political figure).
 *
 * AUTH HISTORY (getting this right took three tries — documenting so a
 * future pass doesn't repeat them):
 *   1. Assumed keyless. Wrong — HTTP 401 in production.
 *   2. Switched to MuckRock's newer Squarelet OAuth2 (username/password
 *      -> short-lived access token via accounts.muckrock.com). Login
 *      succeeded (no auth-endpoint errors), but the actual `api_v1`
 *      resource endpoint *still* returned 401 with a valid Bearer token
 *      — confirmed in production logs. That's a real signal: api_v1
 *      simply doesn't accept the newer OAuth tokens.
 *   3. MuckRock's own API-examples repo (github.com/MuckRock/
 *      API-examples) shows the actually-working scheme for this exact
 *      endpoint: a plain, non-expiring per-account API key from your
 *      MuckRock profile page, sent as `Authorization: Token <key>`.
 *      That's now the primary path (MUCKROCK_API_KEY). The OAuth
 *      username/password path is kept as a fallback in case some
 *      accounts/endpoints do accept it, but the static key is what
 *      MuckRock's own examples use for `api_v1/foia/`.
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

// Module-level cache — access tokens (OAuth path only) are valid 5
// minutes regardless of which MuckRockAgent instance requested one, so
// sharing across the process avoids a redundant login call.
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getOAuthAccessToken(): Promise<string | null> {
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
      console.warn(`[muckrock-agent] OAuth login HTTP ${res.status} — check MUCKROCK_USERNAME/MUCKROCK_PASSWORD`);
      return null;
    }

    const data = (await res.json()) as { access?: string };
    if (!data.access) {
      console.warn(`[muckrock-agent] OAuth login succeeded but response had no access token`);
      return null;
    }

    cachedAccessToken = data.access;
    cachedTokenExpiresAt = now + 4 * 60 * 1000;
    return cachedAccessToken;
  } catch (err) {
    console.warn(`[muckrock-agent] OAuth login request failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Returns the Authorization header value to use, and which scheme it is (for logging). */
async function resolveAuthHeader(): Promise<{ header: string; scheme: string } | null> {
  const apiKey = process.env.MUCKROCK_API_KEY;
  if (apiKey) return { header: `Token ${apiKey}`, scheme: "static-key" };

  const oauthToken = await getOAuthAccessToken();
  if (oauthToken) return { header: `Bearer ${oauthToken}`, scheme: "oauth" };

  return null;
}

export class MuckRockAgent {
  async run(query: string): Promise<{ requests: FoiaRequestEntry[]; sources: Source[] }> {
    const auth = await resolveAuthHeader();
    if (!auth) return { requests: [], sources: [] };

    try {
      const res = await fetch(
        `${MUCKROCK_API_BASE}/foia/?q=${encodeURIComponent(query)}&format=json&page_size=10`,
        {
          headers: { Authorization: auth.header },
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!res.ok) {
        console.warn(`[muckrock-agent] "${query}" (auth=${auth.scheme}) — HTTP ${res.status}`);
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

      console.log(`[muckrock-agent] "${query}" (auth=${auth.scheme}) — ${requests.length} FOIA request(s) found`);

      return { requests, sources };
    } catch (err) {
      console.warn(`[muckrock-agent] "${query}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { requests: [], sources: [] };
    }
  }
}
