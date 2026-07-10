import { CorporateAffiliationEntry, Source } from "../../types/research.js";

/**
 * OpenCorporates Agent (Round 3 — Jackal Person Research, part 1 of 3)
 *
 * Corporate officer/directorship records: every company OpenCorporates
 * has on file where this person shows up as an officer, director, or
 * secretary. Free public API (api.opencorporates.com), works without a
 * key at low volume — set OPENCORPORATES_API_TOKEN to raise the rate
 * limit if usage grows, but it's optional, not required.
 *
 * This is intentionally scoped to Jackal (internal tier) — it's a
 * "search every jurisdiction OpenCorporates indexes for this exact
 * name" query, which is the kind of broad, no-limits lookup that fits
 * the Jackal Protocol's role in this app (see political-agent,
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

  async run(personName: string): Promise<{
    affiliations: CorporateAffiliationEntry[];
    sources: Source[];
  }> {
    try {
      const params = new URLSearchParams({ q: personName, format: "json", per_page: "20" });
      if (this.apiToken) params.set("api_token", this.apiToken);

      const res = await fetch(`${OPENCORPORATES_BASE}/officers/search?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[opencorporates-agent] "${personName}" — HTTP ${res.status}${res.status === 429 ? " (rate limited — consider setting OPENCORPORATES_API_TOKEN)" : ""}`);
        return { affiliations: [], sources: [] };
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
      console.warn(`[opencorporates-agent] "${personName}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { affiliations: [], sources: [] };
    }
  }
}
