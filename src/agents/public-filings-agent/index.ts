import type { FundingEntry, Source } from "../../types/research.js";
import type { SearchProvider } from "../../lib/providers.js";
import { CourtListenerAgent } from "../courtlistener-agent/index.js";
import { mentionsCompany } from "../../lib/news-noise.js";

/**
 * Registry checks for company reports (launch fixes 12-16). Each lookup is
 * a public record, fails open to nothing, and cites the record itself:
 *
 *   courtCases     CourtListener (RECAP federal dockets), by exact name
 *   nlrbCases      NLRB case pages (nlrb.gov/case/...), found by search
 *   npiRecords     NPPES NPI registry, for healthcare businesses
 *   stateFormation a state-record page giving the formation date, for when
 *                  the Secretary of State site blocks automation
 *   formDFilings   SEC Form D, searched by the company's name and every
 *                  fund or subsidiary name the report found
 */

export interface CaseRecord {
  caption: string;
  court?: string;
  docketNumber?: string;
  filed?: string;
  url: string;
}

export interface NpiRecord {
  npi: string;
  name: string;
  /** Authorized official, e.g. "Lilit Gevoglanian, Owner". */
  official?: string;
  enumerated?: string;
  taxonomy?: string;
  location?: string;
  url: string;
}

export interface FormationRecord {
  /** "2017-03-03" or "2017". */
  date: string;
  entityNumber?: string;
  state?: string;
  url: string;
}

// The NPPES API is public and keyless.
const NPPES = "https://npiregistry.cms.hhs.gov/api/";
// SEC asks automated clients to identify themselves.
const SEC_UA = "Metis Research support@metisanalytic.com";

const HEALTHCARE = /\b(health|healthcare|medical|clinic|therapy|therap\w+|aba|behavior(al)? analysis|dental|dentist|pharmacy|hospital|physician|nursing|hospice|home care|chiropract\w*|optometr\w*|psychiatr\w*|psycholog\w*|counseling|rehab\w*|autism)\b/i;

export function isHealthcare(text: string): boolean {
  return HEALTHCARE.test(text);
}

/** "MJW Student Housing Fund II" and the like, named anywhere in the findings. */
export function fundNames(texts: string[], companyName: string): string[] {
  const re = /\b((?:[A-Z][\w&'.-]*\s){0,5}(?:Fund|Partners|Holdings|Capital|Opportunity Zone Fund|Income Fund|Investors)(?:\s(?:[IVX]{1,4}|\d{1,2}))?(?:,?\s(?:LP|L\.P\.|LLC))?)\b/g;
  const out = new Set<string>();
  const first = companyName.split(/\s+/)[0]?.toLowerCase();
  for (const t of texts) {
    for (const m of t.matchAll(re)) {
      const name = m[1].trim();
      // Only the company's own vehicles: they carry its name.
      if (first && name.toLowerCase().startsWith(first) && name.toLowerCase() !== companyName.toLowerCase()) out.add(name);
    }
  }
  return [...out].slice(0, 4);
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[public-filings] ${new URL(url).hostname} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[public-filings] ${url.split("?")[0]} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

interface NppesResponse {
  results?: {
    number?: number | string;
    basic?: {
      organization_name?: string;
      authorized_official_first_name?: string;
      authorized_official_last_name?: string;
      authorized_official_title_or_position?: string;
      enumeration_date?: string;
    };
    addresses?: { address_purpose?: string; city?: string; state?: string }[];
    taxonomies?: { desc?: string; primary?: boolean }[];
  }[];
}

/** Title case for NPPES's all-caps names: "LILIT GEVOGLANIAN" -> "Lilit Gevoglanian". */
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function parseNppes(data: NppesResponse | null, companyName: string): NpiRecord[] {
  return (data?.results ?? [])
    .filter((r) => r.number && r.basic?.organization_name && mentionsCompany(titleCase(r.basic.organization_name), companyName))
    .slice(0, 5)
    .map((r) => {
      const b = r.basic!;
      const official = [b.authorized_official_first_name, b.authorized_official_last_name].filter(Boolean).map((n) => titleCase(n!)).join(" ");
      const loc = r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0];
      return {
        npi: String(r.number),
        name: titleCase(b.organization_name!),
        official: official ? `${official}${b.authorized_official_title_or_position ? `, ${titleCase(b.authorized_official_title_or_position)}` : ""}` : undefined,
        enumerated: b.enumeration_date,
        taxonomy: (r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0])?.desc,
        location: loc?.city ? `${titleCase(loc.city)}${loc.state ? `, ${loc.state}` : ""}` : undefined,
        url: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
      };
    });
}

/** An NLRB case page: nlrb.gov/case/27-CA-374248. */
export function nlrbCase(r: { title: string; url: string; snippet?: string }, companyName: string): CaseRecord | undefined {
  const m = r.url.match(/nlrb\.gov\/case\/(\d{2}-[A-Z]{2}-\d+)/i);
  if (!m || !mentionsCompany(`${r.title} ${r.snippet ?? ""}`, companyName)) return undefined;
  const filed = `${r.title} ${r.snippet ?? ""}`.match(/Date Filed:?\s*([0-9/]+|[A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  return { caption: r.title.replace(/\s*\|\s*National Labor Relations Board.*$/i, "").trim(), court: "NLRB", docketNumber: m[1].toUpperCase(), filed, url: r.url };
}

const FORMED = /\b(?:incorporation|formation|registration|filing|incorporated|formed|registered|file)\s*date:?\s*([A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+ \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const ENTITY_NO = /\b(?:entity|company|file|registration|corporate)\s*(?:number|no\.?|#):?\s*([A-Z]?\d{6,13})\b/i;
const STATE_RECORD_HOSTS = /(^|\.)(opencorporates\.com|bizapedia\.com|opengovus\.com|corporationwiki\.com|californiacorporates\.com|bizprofile\.net|sos\.\w+\.gov|\w+\.sos\.ca\.gov)$/i;

/** A state-record page naming the company and its formation date. */
export function formationFrom(r: { title: string; url: string; snippet?: string }, companyName: string): FormationRecord | undefined {
  let host = "";
  try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch { return undefined; }
  const text = `${r.title}. ${r.snippet ?? ""}`;
  if (!STATE_RECORD_HOSTS.test(host) || !mentionsCompany(text, companyName)) return undefined;
  const date = text.match(FORMED)?.[1];
  if (!date) return undefined;
  const parsed = new Date(`${date} UTC`);
  const iso = isNaN(parsed.getTime()) ? date.match(/\d{4}/)?.[0] : parsed.toISOString().slice(0, 10);
  if (!iso) return undefined;
  return { date: iso, entityNumber: text.match(ENTITY_NO)?.[1], url: r.url };
}

interface EftsResponse {
  hits?: { hits?: { _id?: string; _source?: { display_names?: string[]; file_date?: string; form?: string; ciks?: string[]; adsh?: string } }[] };
}

/** Form D's offering and amount sold, from the filing's primary_doc.xml. */
export function parseFormD(xml: string): { offered?: string; sold?: string; issuer?: string } {
  const tag = (t: string) => xml.match(new RegExp(`<${t}>\\s*([^<]+?)\\s*</${t}>`, "i"))?.[1];
  const money = (v: string | undefined) => {
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : v;
  };
  return { offered: money(tag("totalOfferingAmount")), sold: money(tag("totalAmountSold")), issuer: tag("entityName") };
}

export class PublicFilingsAgent {
  constructor(private searcher: SearchProvider) {}

  async courtCases(companyName: string): Promise<{ cases: CaseRecord[]; sources: Source[] }> {
    const { records } = await new CourtListenerAgent().run(`"${companyName}"`);
    const cases = records
      .filter((r) => mentionsCompany(r.caseName, companyName))
      .map((r) => ({ caption: r.caseName, court: r.court, docketNumber: r.docketNumber, filed: r.dateFiled, url: r.url }));
    return { cases, sources: cases.map((c) => source(c.url, `CourtListener — ${c.caption}`, "court-records")) };
  }

  async nlrbCases(companyName: string): Promise<{ cases: CaseRecord[]; sources: Source[] }> {
    const results = await this.searcher.search(`site:nlrb.gov/case "${companyName}"`, 8);
    const cases = results.map((r) => nlrbCase(r, companyName)).filter((c): c is CaseRecord => !!c);
    return { cases, sources: cases.map((c) => source(c.url, `NLRB case ${c.docketNumber}`, "court-records")) };
  }

  async npiRecords(companyName: string, state?: string): Promise<{ records: NpiRecord[]; sources: Source[] }> {
    const name = companyName.replace(/,?\s+(llc|inc\.?|corp\.?|pc|p\.c\.)$/i, "").trim();
    const params = new URLSearchParams({ version: "2.1", organization_name: `${name}*`, limit: "20" });
    if (state) params.set("state", state);
    const records = parseNppes(await getJson<NppesResponse>(`${NPPES}?${params}`), companyName);
    return { records, sources: records.map((r) => source(r.url, `NPPES NPI registry — ${r.name} (${r.npi})`, "public-filings")) };
  }

  async stateFormation(companyName: string, state?: string): Promise<{ record?: FormationRecord; sources: Source[] }> {
    const results = await this.searcher.search(`"${companyName}"${state ? ` ${state}` : ""} incorporation date entity number`, 8);
    const record = results.map((r) => formationFrom(r, companyName)).find(Boolean);
    return { record, sources: record ? [source(record.url, `State business record — ${companyName}`, "overview")] : [] };
  }

  async formDFilings(names: string[]): Promise<{ funding: FundingEntry[]; sources: Source[] }> {
    const funding: FundingEntry[] = [];
    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const name of names.slice(0, 5)) {
      const data = await getJson<EftsResponse>(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${name}"`)}&forms=D`, { "user-agent": SEC_UA });
      for (const hit of (data?.hits?.hits ?? []).slice(0, 3)) {
        const s = hit._source;
        const cik = s?.ciks?.[0]?.replace(/^0+/, "");
        const adsh = s?.adsh ?? hit._id?.split(":")[0];
        if (!cik || !adsh || seen.has(adsh)) continue;
        if (!(s?.display_names ?? []).some((d) => mentionsCompany(d, name))) continue;
        seen.add(adsh);
        const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}`;
        const xml = await getText(`${folder}/primary_doc.xml`, { "user-agent": SEC_UA });
        const d = xml ? parseFormD(xml) : {};
        const issuer = d.issuer ?? s?.display_names?.[0]?.replace(/\s*\(CIK.*$/, "") ?? name;
        funding.push({
          round: `Form D: ${issuer}`,
          amount: d.sold ? `${d.sold} sold${d.offered ? ` of ${d.offered} offered` : ""}` : d.offered ? `${d.offered} offered` : undefined,
          date: s?.file_date,
        });
        sources.push(source(`${folder}/`, `SEC Form D — ${issuer}${s?.file_date ? ` (${s.file_date})` : ""}`, "funding"));
      }
    }
    return { funding, sources };
  }
}

function source(url: string, title: string, usedFor: string): Source {
  return { url, title, retrievedAt: new Date().toISOString(), usedFor: [usedFor] };
}
