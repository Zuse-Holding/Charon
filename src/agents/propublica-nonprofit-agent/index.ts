import { NonprofitFilingEntry, NonprofitFinancials, NonprofitYear, Source } from "../../types/research.js";
import { strongNameMatch } from "../../lib/name-match.js";
import { htmlToFullText } from "../../lib/providers.js";

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

const dollars = (s: string | undefined) => (s ? Number(s.replace(/[$,]/g, "")) : undefined);

/**
 * Years the organization's page shows that the API doesn't yet have
 * (launch fix P2: Homeboy's 2024 990 was on the page, not in the API).
 * Each "Fiscal year ending" block, read for its revenue, expenses and
 * assets; a block without a revenue figure is skipped.
 */
export function pageYears(html: string): NonprofitYear[] {
  const text = htmlToFullText(html);
  const parts = text.split(/(?=Fiscal year ending\s)/i).filter((p) => /^Fiscal year ending/i.test(p));
  const out: NonprofitYear[] = [];
  for (const p of parts) {
    const year = p.match(/^Fiscal year ending\s+(?:[A-Z][a-z]{2,8}\.?\s+(?:\d{1,2},?\s+)?)?(\d{4})/i)?.[1];
    const block = p.slice(0, 3000);
    const num = (label: RegExp) => dollars(block.match(new RegExp(`${label.source}\\s*\\$?\\s*(-?[\\d,]{4,})`, "i"))?.[1]);
    const revenue = num(/Total Revenue/);
    if (!year || revenue === undefined || out.some((y) => y.year === year)) continue;
    out.push({ year, revenue, expenses: num(/Total Functional Expenses|Total Expenses/), assets: num(/Total Assets/),
      contributions: num(/Contributions(?:,? Gifts,? Grants)?|Contributions Received/) });
  }
  return out;
}

/**
 * The organization this report is about, of the search's matches: its name
 * is the company's, and its state the HQ's when both are known.
 */
// A company's foundation or fund is a separate entity (launch fix 77:
// the Graybar Foundation's 990-PFs were shown as Graybar's funding).
const CHARITY_VEHICLE = /\b(foundation|fund|trust|charitable|endowment|charities)\b/i;

export function subjectOrganization(orgs: NonprofitFilingEntry[], name: string, state?: string): NonprofitFilingEntry | undefined {
  const vehicle = (n: string) => n.match(CHARITY_VEHICLE)?.[1].toLowerCase();
  const named = orgs.filter((o) => strongNameMatch(o.name, name) && (!vehicle(o.name) || vehicle(o.name) === vehicle(name)));
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

      const candidates: NonprofitFilingEntry[] = results
        .filter((r): r is NonprofitSearchResult & { ein: number; name: string } => Boolean(r.ein && r.name))
        .slice(0, 25)
        .map((r) => ({
          ein: String(r.ein).padStart(9, "0"),
          name: r.name,
          ntee: r.ntee_code,
          city: r.city,
          state: r.state,
          url: `https://projects.propublica.org/nonprofits/organizations/${r.ein}`,
        }));

      // Only the organization this report is about (launch fix 40): Crumbl
      // listed "Crumbs From Christ" and nine other unrelated nonprofits.
      const org = subjectOrganization(candidates, name, state);
      const organizations = org ? [org] : [];
      const sources: Source[] = org
        ? [{ url: org.url, title: `ProPublica Nonprofit Explorer — ${org.name}`, retrievedAt: new Date().toISOString(), usedFor: ["nonprofit"] }]
        : [];

      // The matching organization's 990 figures (launch fix 33: Homeboy's
      // record was linked but its revenue never pulled).
      const financials = org ? await this.financials(org) : undefined;

      console.log(`[propublica-nonprofit-agent] "${name}" — ${org ? `matched EIN ${org.ein}` : "no matching organization"} of ${candidates.length} result(s)${financials ? `, ${financials.years.length} year(s) of 990 figures for EIN ${financials.ein}` : ""}`);

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
      let years = nonprofitYears(data.filings_with_data ?? []);
      // Always the latest filing: the page can be a year ahead of the API.
      try {
        const page = await fetch(org.url, { signal: AbortSignal.timeout(15_000) });
        const newer = page.ok ? pageYears(await page.text()).filter((y) => !years.length || y.year > years[0].year) : [];
        if (newer.length) {
          console.log(`[propublica-nonprofit-agent] EIN ${org.ein}: ${newer.map((y) => y.year).join(", ")} from the organization page`);
          years = [...newer, ...years].sort((a, b) => b.year.localeCompare(a.year)).slice(0, 3);
        }
      } catch { /* the API's years stand */ }
      return years.length ? { ein: org.ein, name: org.name, url: org.url, years } : undefined;
    } catch {
      return undefined;
    }
  }
}
