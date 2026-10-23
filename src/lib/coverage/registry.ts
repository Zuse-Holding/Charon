import { isEnabled, type Flag } from "../flags.js";

/**
 * Source registry for the coverage ledger (Feature 1). One entry per place
 * a report can look. Automated sources ("api") are run by the
 * orchestrator; "deep_link" sources can't be automated (no API, a CAPTCHA,
 * paid access or terms that forbid it), so the report links to them with
 * the search pre-filled where the site supports it.
 *
 * Every report lists every source for its report type, including the ones
 * it skipped. Add a source here and it appears in every matching report.
 */

export const CATEGORIES = [
  "web", "news", "corporate filings", "courts", "liens", "sanctions",
  "government contracts", "nonprofits", "relationships", "archives", "records requests", "domain records",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ReportKind = "company" | "person";

export interface SourceDef {
  id: string;
  name: string;
  jurisdiction: string;
  category: Category;
  access: "api" | "deep_link";
  reports: ReportKind[];
  /** Report section the source's results appear in. */
  section?: string;
  /** Hosts whose failed responses (5xx, 429, network error) mean the
   *  search itself failed, not that it found nothing. */
  hosts?: string[];
  /** Environment variables without which the source can't run at all. */
  requiresEnv?: string[];
  /** Deep link. {q} is replaced with the URL-encoded query. */
  urlTemplate?: string;
  /** Why a deep_link source isn't searched automatically. */
  reason?: string;
  /** Listed only while this feature flag is on. */
  flag?: Flag;
}

const SERPER = "google.serper.dev";

export const SOURCES: SourceDef[] = [
  // Automated
  { id: "website", name: "Company website and web search", jurisdiction: "Global", category: "web", access: "api",
    reports: ["company"], section: "Leadership", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"] },
  { id: "news", name: "News search", jurisdiction: "Global", category: "news", access: "api",
    reports: ["company"], section: "Recent News", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"] },
  { id: "competitors", name: "Competitor search", jurisdiction: "Global", category: "web", access: "api",
    reports: ["company"], section: "Competitors", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"] },
  { id: "sec", name: "Funding news and insider filings (Form 4)", jurisdiction: "US federal", category: "corporate filings", access: "api",
    reports: ["company"], section: "Funding and Insider Activity", hosts: ["data.sec.gov", "www.sec.gov", "efts.sec.gov", SERPER], requiresEnv: ["SERPER_API_KEY"],
    urlTemplate: "https://www.sec.gov/cgi-bin/browse-edgar?company={q}&type=&dateb=&owner=include&count=40" },
  { id: "usaspending", name: "USAspending federal awards", jurisdiction: "US federal", category: "government contracts", access: "api",
    reports: ["company"], section: "Federal Spending", hosts: ["api.usaspending.gov"],
    urlTemplate: "https://www.usaspending.gov/search?keyword={q}" },
  { id: "people", name: "Web search for the person", jurisdiction: "Global", category: "web", access: "api",
    reports: ["person"], section: "Current Role", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"] },
  { id: "opencorporates", name: "OpenCorporates officer records", jurisdiction: "Global", category: "corporate filings", access: "api",
    reports: ["person"], section: "Corporate Affiliations", hosts: ["api.opencorporates.com"],
    urlTemplate: "https://opencorporates.com/officers?q={q}" },
  { id: "muckrock", name: "MuckRock FOIA requests", jurisdiction: "US", category: "records requests", access: "api",
    reports: ["person"], section: "FOIA Requests", hosts: ["www.muckrock.com", "accounts.muckrock.com"],
    urlTemplate: "https://www.muckrock.com/foi/list/?q={q}" },
  { id: "sanctions", name: "Consolidated Screening List (OFAC and others)", jurisdiction: "US federal", category: "sanctions", access: "api",
    reports: ["company", "person"], section: "Public Records", hosts: ["data.trade.gov", "api.trade.gov"], requiresEnv: ["TRADE_GOV_API_KEY"],
    urlTemplate: "https://sanctionssearch.ofac.treas.gov/" },
  { id: "wayback", name: "Wayback Machine archive", jurisdiction: "Global", category: "archives", access: "api",
    reports: ["company"], section: "Public Records", hosts: ["web.archive.org", "archive.org"],
    urlTemplate: "https://web.archive.org/web/*/{q}" },
  { id: "nonprofits", name: "ProPublica Nonprofit Explorer", jurisdiction: "US federal", category: "nonprofits", access: "api",
    reports: ["company", "person"], section: "Public Records", hosts: ["projects.propublica.org"],
    urlTemplate: "https://projects.propublica.org/nonprofits/search?q={q}" },
  { id: "domain", name: "Domain records (RDAP, public DNS, TLS certificate)", jurisdiction: "Global", category: "domain records", access: "api",
    reports: ["company"], section: "Domain Posture", hosts: ["data.iana.org", "cloudflare-dns.com"], flag: "domain_posture",
    urlTemplate: "https://lookup.icann.org/en/lookup?name={q}" },
  { id: "related", name: "New York Department of State filings (related entities)", jurisdiction: "New York", category: "corporate filings",
    access: "api", reports: ["company"], section: "Related Entities", hosts: ["data.ny.gov"], flag: "related_entities",
    urlTemplate: "https://data.ny.gov/resource/n9v6-gdp6.json?current_entity_name={q}" },
  { id: "littlesis", name: "LittleSis power map", jurisdiction: "US", category: "relationships", access: "api",
    reports: ["company", "person"], section: "Public Records", hosts: ["littlesis.org"],
    urlTemplate: "https://littlesis.org/search?q={q}" },

  // Registry checks (launch fixes 12-16).
  { id: "courtlistener", name: "CourtListener federal court dockets", jurisdiction: "US", category: "courts", access: "api",
    reports: ["company"], section: "Court and Agency Records", hosts: ["www.courtlistener.com"],
    urlTemplate: "https://www.courtlistener.com/?q=%22{q}%22" },
  { id: "nlrb", name: "NLRB case search", jurisdiction: "US federal", category: "courts", access: "api",
    reports: ["company"], section: "Court and Agency Records", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"],
    urlTemplate: "https://www.nlrb.gov/search/case/{q}" },
  { id: "npi", name: "NPPES NPI registry (healthcare providers)", jurisdiction: "US federal", category: "corporate filings", access: "api",
    reports: ["company"], section: "Court and Agency Records", hosts: ["npiregistry.cms.hhs.gov"],
    urlTemplate: "https://npiregistry.cms.hhs.gov/search?organizationName={q}" },
  { id: "state-records", name: "State business records (formation date, entity number)", jurisdiction: "US", category: "corporate filings", access: "api",
    reports: ["company"], section: "Company Overview", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"] },
  { id: "edgar", name: "SEC filings: 10-K, financial data and proxy", jurisdiction: "US federal", category: "corporate filings", access: "api",
    reports: ["company"], section: "SEC Filings", hosts: ["efts.sec.gov", "data.sec.gov", "www.sec.gov"],
    urlTemplate: "https://efts.sec.gov/LATEST/search-index?q=%22{q}%22&forms=10-K" },
  { id: "formd", name: "SEC Form D filings (company and fund names)", jurisdiction: "US federal", category: "corporate filings", access: "api",
    reports: ["company"], section: "Funding", hosts: ["efts.sec.gov", "www.sec.gov"],
    urlTemplate: "https://efts.sec.gov/LATEST/search-index?q=%22{q}%22&forms=D" },

  { id: "fdd", name: "Franchise Disclosure Document figures (franchisors)", jurisdiction: "US", category: "corporate filings", access: "api",
    reports: ["company"], section: "Franchise Disclosure", hosts: [SERPER], requiresEnv: ["SERPER_API_KEY"] },

  // Deep link only
  { id: "state-courts", name: "State court records", jurisdiction: "US states", category: "courts", access: "deep_link",
    reports: ["company"], reason: "State courts aren't searched automatically; CourtListener covers federal courts. Check the state's own court portal.",
    urlTemplate: "https://www.google.com/search?q=%22{q}%22+state+court+case" },
  { id: "wi-fdd", name: "Wisconsin franchise registry (FDDs)", jurisdiction: "Wisconsin", category: "corporate filings", access: "deep_link",
    reports: ["company"], reason: "Search form only; no API.", urlTemplate: "https://www.google.com/search?q=site%3Adfi.wi.gov+%22{q}%22+franchise" },
  { id: "mn-fdd", name: "Minnesota CARDS franchise filings (FDDs)", jurisdiction: "Minnesota", category: "corporate filings", access: "deep_link",
    reports: ["company"], reason: "Search form only; no API.", urlTemplate: "https://www.google.com/search?q=site%3Acards.commerce.state.mn.us+%22{q}%22" },
  { id: "courtlistener-person", name: "CourtListener federal and state courts", jurisdiction: "US", category: "courts", access: "deep_link",
    reports: ["person"], reason: "Not searched automatically in this report.",
    urlTemplate: "https://www.courtlistener.com/?q=%22{q}%22" },
  { id: "pacer", name: "PACER federal court records", jurisdiction: "US federal", category: "courts", access: "deep_link",
    reports: ["company", "person"], reason: "Paid, registered accounts only; no public API.",
    urlTemplate: "https://pcl.uscourts.gov/pcl/index.jsf" },
  { id: "ca-sos", name: "California Secretary of State business search", jurisdiction: "California", category: "corporate filings", access: "deep_link",
    reports: ["company"], reason: "No public API, and the site blocks automated searches.",
    urlTemplate: "https://bizfileonline.sos.ca.gov/search/business" },
  { id: "de-icis", name: "Delaware Division of Corporations entity search", jurisdiction: "Delaware", category: "corporate filings", access: "deep_link",
    reports: ["company"], reason: "Search is behind a CAPTCHA.",
    urlTemplate: "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx" },
  { id: "ca-ucc", name: "California UCC lien search", jurisdiction: "California", category: "liens", access: "deep_link",
    reports: ["company"], reason: "No public API, and the site blocks automated searches.",
    urlTemplate: "https://bizfileonline.sos.ca.gov/search/ucc" },
];

export function sourcesFor(report: ReportKind, env: Record<string, string | undefined> = process.env): SourceDef[] {
  return SOURCES.filter((s) => s.reports.includes(report) && (!s.flag || isEnabled(s.flag, env)));
}

export function sourceById(id: string): SourceDef {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown coverage source: ${id}`);
  return s;
}

/** A deep link with the query filled in. Templates without {q} link to the
 *  search page itself. */
export function deepLink(s: SourceDef, query: string): string | undefined {
  return s.urlTemplate?.replace("{q}", encodeURIComponent(query));
}
