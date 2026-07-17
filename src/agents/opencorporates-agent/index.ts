import { CorporateAffiliationEntry, Source } from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { CorporateAffiliationExtractionSchema, extractStructured } from "../../lib/llm.js";

/**
 * OpenCorporates Agent (Round 3 — Charon Person Research, part 1 of 3)
 *
 * Corporate officer/directorship records: every company OpenCorporates
 * has on file where this person shows up as an officer, director, or
 * secretary. Free public API (api.opencorporates.com) — this comment
 * used to say it "works without a key at low volume," which stopped
 * being true (confirmed in production: unauthenticated requests now
 * come back HTTP 401 regardless of volume, and getting a token requires
 * OpenCorporates' manual approval process, not instant signup).
 *
 * Falls back to the same search-and-synthesize pattern as form4-agent
 * whenever the direct API is unavailable (401/429/network error) —
 * targeted search + LLM extraction with same-source grounding (full page
 * text where fetchable, snippet otherwise — same pattern as
 * people-agent/news-agent), so the feature still works without
 * OPENCORPORATES_API_TOKEN rather than going straight to "no results."
 * Once a token is added, the direct API (structured, more complete) is
 * tried first and this is just a safety net again.
 *
 * This is intentionally scoped to Charon (internal tier) — it's a
 * "search every jurisdiction OpenCorporates indexes for this exact
 * name" query, which is the kind of broad, no-limits lookup that fits
 * the Charon Protocol's role in this app (see political-agent,
 * people-agent deep mode) rather than something every tier should get
 * by default.
 *
 * NOTE on the other two items from the original "PACER, OpenCorporates,
 * Form 4, property records" list:
 *   - PACER (federal court records) requires a paid, individually
 *     registered account with credential-based login and per-page
 *     billing — there's no free/keyless API path, so it's not built
 *     here. If you get PACER credentials, this is a real v2 addition.
 *   - Property records have no unified national API — ownership
 *     records live in ~3,000 separate county assessor/recorder systems,
 *     each with its own (often non-API, form-scraping-only) access
 *     method. Not feasible to build generically; would need to be
 *     scoped to specific counties on request.
 * Form 4 (SEC insider filings) already exists for companies
 * (src/agents/form4-agent) but that agent's extraction prompt is
 * company-centric ("is this person an insider of THIS company") — reusing
 * it as-is for a person-first query would produce a nonsensical prompt.
 * A proper person-centric Form 4 lookup is a clean, scoped v2 addition,
 * not bundled into tonight's build.
 */

const OPENCORPORATES_BASE = "https://api.opencorporates.com/v0.4";

interface OcOfficer {
  name?: string;
  position?: string;
  start_date?: string;
  end_date?: string;
  company?: {
    name?: string;
    jurisdiction_code?: string;
    opencorporates_url?: string;
  };
}

interface OcOfficerSearchResponse {
  results?: {
    officers?: { officer: OcOfficer }[];
  };
}

export class OpenCorporatesAgent {
  private apiToken = process.env.OPENCORPORATES_API_TOKEN;

  constructor(
    private searcher: SearchProvider,
    private fetcher: FetchProvider
  ) {}

  async run(personName: string): Promise<{
    affiliations: CorporateAffiliationEntry[];
    sources: Source[];
  }> {
    const direct = await this.runDirectApi(personName);
    if (direct) return direct;
    return this.runSearchFallback(personName);
  }

  /** Returns null (not an empty result) on failure, so run() knows to fall back. */
  private async runDirectApi(personName: string): Promise<{
    affiliations: CorporateAffiliationEntry[];
    sources: Source[];
  } | null> {
    try {
      const params = new URLSearchParams({ q: personName, format: "json", per_page: "20" });
      if (this.apiToken) params.set("api_token", this.apiToken);

      const res = await fetch(`${OPENCORPORATES_BASE}/officers/search?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[opencorporates-agent] "${personName}" — HTTP ${res.status}${res.status === 429 ? " (rate limited — consider setting OPENCORPORATES_API_TOKEN)" : ""}, falling back to search-and-synthesize`);
        return null;
      }

      const data = (await res.json()) as OcOfficerSearchResponse;
      const officers = (data.results?.officers ?? []).map((o) => o.officer);

      // Loose name-match guard, same pattern as usaspending-agent —
      // OpenCorporates' own search relevance is usually good, but a
      // common name (e.g. "John Smith") can pull in unrelated people.
      const needle = personName.toLowerCase();
      const filtered = officers.filter((o) => {
        const name = (o.name ?? "").toLowerCase();
        return name.includes(needle) || needle.includes(name);
      });

      const affiliations: CorporateAffiliationEntry[] = filtered
        .filter((o) => o.company?.name)
        .map((o) => ({
          companyName: o.company!.name as string,
          position: o.position,
          jurisdiction: o.company?.jurisdiction_code,
          startDate: o.start_date,
          endDate: o.end_date,
          companyUrl: o.company?.opencorporates_url,
        }));

      const sources: Source[] = affiliations.length > 0
        ? [{
            url: `https://opencorporates.com/officers?q=${encodeURIComponent(personName)}`,
            title: `OpenCorporates — ${personName}`,
            retrievedAt: new Date().toISOString(),
            usedFor: ["corporate-affiliations"],
          }]
        : [];

      return { affiliations, sources };
    } catch (err) {
      console.warn(`[opencorporates-agent] "${personName}" — direct API lookup failed:`, err instanceof Error ? err.message : err, "— falling back to search-and-synthesize");
      return null;
    }
  }

  /**
   * Search-and-synthesize fallback, same pattern as form4-agent: targeted
   * search + LLM extraction with same-snippet grounding, so a common name
   * can't get a directorship attributed from an unrelated source.
   */
  private async runSearchFallback(personName: string): Promise<{
    affiliations: CorporateAffiliationEntry[];
    sources: Source[];
  }> {
    try {
      const results = await this.searcher.search(
        `"${personName}" board of directors officer corporate director OpenCorporates registered agent`,
        6
      );

      if (results.length === 0) {
        console.log(`[opencorporates-agent] "${personName}" — 0 search results, nothing to extract from`);
        return { affiliations: [], sources: [] };
      }

      const sources: Source[] = results.map((r) => ({
        url: r.url,
        title: r.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["corporate-affiliations"],
      }));

      // Full page text for the top few results — richer context than a
      // snippet for pulling out an actual directorship. Stays scoped to
      // its own numbered source below, same as snippets, so this doesn't
      // weaken the same-source grounding rule.
      const fetchedPages = await Promise.all(
        results.slice(0, 3).map((r) => fetchPageText(r.url, this.fetcher, 2500))
      );

      const combinedText = results
        .map((r, i) => {
          const fullText = fetchedPages[i];
          return `SOURCE ${i + 1} (${r.url}):\nTitle: ${r.title}\n${fullText ? `Full text: ${fullText}` : `Snippet: ${r.snippet ?? ""}`}`;
        })
        .join("\n\n");

      const llmResult = await extractStructured(
        `You are a corporate-records research assistant extracting officer/director affiliations specifically for "${personName}" from search results.

RULES:
- Only include a company if the SAME numbered source explicitly names "${personName}" AND ties them to that company as an officer, director, or secretary. Never combine a name from one source with a company mentioned in a different source.
- companyName: the company's full legal or commonly-used name exactly as it appears in that source.
- position: their role (e.g. "Director", "Officer", "Secretary"), if stated.
- jurisdiction: the state/country of incorporation, if stated.
- startDate/endDate: only if a specific date is given in the source text.
- If you are not confident "${personName}" is actually an officer/director of a given company (as opposed to some other person with a similar or common name), omit that entry.
- Return an empty affiliations array if no source contains a specific, clearly-attributed directorship — do not pad with generic or uncertain entries.`,
        combinedText,
        CorporateAffiliationExtractionSchema
      );

      const rawCount = llmResult?.affiliations?.length ?? 0;
      const affiliations: CorporateAffiliationEntry[] = llmResult?.affiliations ?? [];

      console.log(`[opencorporates-agent] "${personName}" — search fallback: ${results.length} search result(s), LLM returned ${rawCount}`);

      return { affiliations, sources };
    } catch (err) {
      console.warn(`[opencorporates-agent] "${personName}" — search fallback failed:`, err instanceof Error ? err.message : err);
      return { affiliations: [], sources: [] };
    }
  }
}
