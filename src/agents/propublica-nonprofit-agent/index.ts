import { NonprofitFilingEntry, NonprofitFinancials, NonprofitYear, Source } from "../../types/research.js";
import { mentionsCompany } from "../../lib/news-noise.js";

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

interface OrgFiling {
  tax_prd_yr?: number;
  formtype?: number | string;
  totrevenue?: number;
  totfuncexpns?: number;
  totassetsend?: number;
  totcntrbgfts?: number;
  compnsatncurrofcr?: number;
  pdf_url?: string | null;
}

const FORM: Record<string, string> = { "0": "990", "1": "990-EZ", "2": "990-PF" };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The last three 990 years, newest first (launch fix 33). */
export function nonprofitYears(filings: OrgFiling[]): NonprofitYear[] {
  return filings
    .filter((f) => f.tax_prd_yr && (num(f.totrevenue) !== undefined || num(f.totfuncexpns) !== undefined))
    .sort((a, b) => (b.tax_prd_yr ?? 0) - (a.tax_prd_yr ?? 0))
    .slice(0, 3)
    .map((f) => ({
      year: String(f.tax_prd_yr),
      formType: f.formtype !== undefined ? FORM[String(f.formtype)] ?? String(f.formtype) : undefined,
      revenue: num(f.totrevenue),
      expenses: num(f.totfuncexpns),
      assets: num(f.totassetsend),
      contributions: num(f.totcntrbgfts),
      officerPay: num(f.compnsatncurrofcr),
      pdfUrl: f.pdf_url ?? undefined,
    }));
}

/**
 * The organization this report is about, of the search's matches: its name
 * is the company's, and its state the HQ's when both are known.
 */
export function subjectOrganization(orgs: NonprofitFilingEntry[], name: string, state?: string): NonprofitFilingEntry | undefined {
  const named = orgs.filter((o) => mentionsCompany(o.name, name) || mentionsCompany(name, o.name));
  return named.find((o) => !state || !o.state || o.state === state) ?? (state ? undefined : named[0]);
}

export class ProPublicaNonprofitAgent {
  /** @param state The HQ's two-letter state, to pick the right organization. */
  async run(name: string, state?: string): Promise<{ organizations: NonprofitFilingEntry[]; financials?: NonprofitFinancials; sources: Source[] }> {
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
          city: r.city,
          state: r.state,
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

      // The matching organization's 990 figures (launch fix 33: Homeboy's
      // record was linked but its revenue never pulled).
      const org = subjectOrganization(organizations, name, state);
      const financials = org ? await this.financials(org) : undefined;
      if (financials) {
        sources.push({ url: financials.url, title: `Form 990 filings — ${financials.name} (ProPublica)`, retrievedAt: new Date().toISOString(), usedFor: ["nonprofit"] });
      }

      console.log(`[propublica-nonprofit-agent] "${name}" — ${organizations.length} match(es)${financials ? `, ${financials.years.length} year(s) of 990 figures for EIN ${financials.ein}` : ""}`);

      return { organizations, financials, sources };
    } catch (err) {
      console.warn(`[propublica-nonprofit-agent] "${name}" — lookup failed:`, err instanceof Error ? err.message : err);
      return { organizations: [], sources: [] };
    }
  }

  private async financials(org: NonprofitFilingEntry): Promise<NonprofitFinancials | undefined> {
    try {
      const res = await fetch(`${NONPROFIT_BASE}/organizations/${Number(org.ein)}.json`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { filings_with_data?: OrgFiling[] };
      const years = nonprofitYears(data.filings_with_data ?? []);
      return years.length ? { ein: org.ein, name: org.name, url: org.url, years } : undefined;
    } catch {
      return undefined;
    }
  }
}
