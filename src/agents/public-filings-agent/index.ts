import type { FundingEntry, Source } from "../../types/research.js";
import type { SearchProvider } from "../../lib/providers.js";
import { CourtListenerAgent } from "../courtlistener-agent/index.js";
import { distinctiveWords, partyIs, strongNameMatch } from "../../lib/name-match.js";
import { secJson, secText } from "../../lib/sec-http.js";
import { mentionsCompany } from "../../lib/news-noise.js";
import { extractStructured, FddExtractionSchema } from "../../lib/llm.js";

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
  /** The company's side (launch fix 21). "charged" is an NLRB charge against it. */
  role?: "plaintiff" | "defendant" | "debtor" | "charged" | "unknown";
  /** Nature of suit or cause, as the docket gives it. */
  caseType?: string;
  /** "status unverified": no end date, but filed over three years ago
   *  (launch fix 82: a 2019 "open" case became Andersen's top risk). */
  status?: "open" | "closed" | "status unverified";
  /** A bankruptcy case in which the company isn't the debtor: usually a
   *  routine collection or preference matter, not a risk. */
  routine?: boolean;
  /** Brought forward from an earlier run (round 17). */
  carried?: boolean;
}

/**
 * "Blyden v. Graybar Electric Company" -> defendant; "In re Graybar" ->
 * debtor. The company must be a party itself, not a namesake (launch fixes
 * 57, 58: "PATAGONIA, INC. v. PATAGONIA CANDLES LLC" was read as a suit
 * against Patagonia because "Patagonia Candles" contains its name).
 * @param names The company's names: resolved, legal, short.
 */
export function caseRole(caption: string, names: string | string[]): CaseRecord["role"] {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const inRe = caption.match(/^in re:?\s+(.+)$/i);
  if (inRe) return partyIs(inRe[1], list) ? "debtor" : "unknown";
  const parts = caption.split(/\s+v(?:s)?\.?\s+/i);
  if (parts.length < 2) return "unknown";
  const plaintiff = partyIs(parts[0], list);
  const defendant = partyIs(parts.slice(1).join(" v. "), list);
  if (plaintiff && !defendant) return "plaintiff";
  if (defendant && !plaintiff) return "defendant";
  return "unknown";
}

/** The company is a party to this caption at all (exact party, not a namesake). */
export function isParty(caption: string, names: string[]): boolean {
  const inRe = caption.match(/^in re:?\s+(.+)$/i);
  if (inRe) return partyIs(inRe[1], names);
  return caption.split(/\s+v(?:s)?\.?\s+/i).some((side) => partyIs(side, names));
}

const BANKRUPTCY_COURT = /^[a-z]{2,4}b$/;
const STALE_OPEN_MS = 3 * 365 * 86_400_000;

/**
 * A caption side that is one bare word ("Andersen") names no company
 * (launch fix 82: S.D. Tex. and C.D. Cal. dockets titled just "Andersen").
 */
export function namedParty(caption: string, names: string[]): boolean {
  const inRe = caption.match(/^in re:?\s+(.+)$/i);
  const sides = inRe ? [inRe[1]] : caption.split(/\s+v(?:s)?\.?\s+/i);
  // Unless that word is the whole name ("Patagonia v. United States").
  const whole = bareName(names[0] ?? "").toLowerCase();
  const bare = (side: string) => /^\s*[\w&.'’-]+\s*(,?\s*et al\.?)?\s*$/i.test(side) && side.replace(/,?\s*et al\.?/i, "").trim().toLowerCase() !== whole;
  return sides.some((side) => !bare(side) && partyIs(side, names));
}

/** Role, status and whether it's routine, from a CourtListener docket. */
export function caseContext(r: { caseName: string; courtId?: string; court?: string; nature?: string; dateTerminated?: string; dateFiled?: string }, companyName: string | string[], now = Date.now()): Pick<CaseRecord, "role" | "caseType" | "status" | "routine"> {
  const role = caseRole(r.caseName, companyName);
  const bankruptcy = BANKRUPTCY_COURT.test(r.courtId ?? "") || /bankruptcy/i.test(r.court ?? "");
  const filed = r.dateFiled ? Date.parse(r.dateFiled) : NaN;
  const stale = !isNaN(filed) && now - filed > STALE_OPEN_MS;
  return {
    role,
    caseType: r.nature || (bankruptcy ? "Bankruptcy" : undefined),
    status: r.dateTerminated ? "closed" : stale ? "status unverified" : "open",
    routine: bankruptcy && role !== "debtor" ? true : undefined,
  };
}

/**
 * Most material first: cases against the company, open, newest; routine
 * bankruptcy matters last. A 2016 suit Graybar brought must never outrank
 * the Oct 2026 Blyden suit against it.
 */
export function rankCases(cases: CaseRecord[]): CaseRecord[] {
  const weight = (c: CaseRecord) => (c.routine ? -10 : 0)
    + (c.role === "defendant" || c.role === "charged" || c.role === "debtor" ? 4 : c.role === "plaintiff" ? -2 : 0)
    + (c.status === "open" ? 2 : 0);
  const time = (c: CaseRecord) => {
    const t = c.filed ? Date.parse(c.filed) : NaN;
    return isNaN(t) ? 0 : t;
  };
  return [...cases].sort((a, b) => weight(b) - weight(a) || time(b) - time(a));
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

/**
 * A fund the company is raising and its target (launch fix 47: MJW lost
 * its "$100M Student Housing Fund" target between runs). A sentence that
 * names a fund and a target or raise amount.
 */
export function fundTargets(items: { text: string; url?: string; date?: string }[], companyName: string): (FundingEntry & { url?: string })[] {
  const out: (FundingEntry & { url?: string })[] = [];
  const amount = /\b(?:target(?:ing|s|ed)?|seeking to raise|plans? to raise|aims? to raise|to raise|up to|hard cap of|capitalization of)\b[^.$]{0,40}?(\$\s?\d+(?:\.\d+)?\s?(?:million|billion|mm|m|b)\b)/i;
  for (const it of items) {
    for (const sentence of it.text.split(/(?<=[.!?])\s+/)) {
      if (!/\bfund\b/i.test(sentence)) continue;
      const m = sentence.match(amount);
      if (!m) continue;
      const name = fundNames([sentence], companyName)[0] ?? sentence.match(/\b((?:[A-Z][\w&'.-]*\s){1,5}Fund(?:\s(?:[IVX]{1,4}|\d{1,2}))?)\b/)?.[1]?.trim();
      const round = `${name ?? "Fund"} (target)`;
      if (out.some((o) => o.round === round)) continue;
      out.push({ round, amount: m[1].replace(/\s+/g, " "), date: it.date, url: it.url });
    }
  }
  return out.slice(0, 3);
}

/**
 * The names a company files under (launch fix 27): as searched, without
 * its legal suffix, and with ", Inc." ("Gecko Robotics" ->
 * "Gecko Robotics, Inc."). Search is case-insensitive, so no upper-case copy.
 */
/** "Gecko Robotics, Inc." -> "Gecko Robotics". */
export function bareName(companyName: string): string {
  return companyName.replace(/,?\s+(inc\.?|llc|corp\.?|corporation|co\.?|company|ltd\.?)$/i, "").trim() || companyName;
}

/**
 * The Form D's issuer is the company itself, or for a fund sponsor one of
 * its own funds ("MJW ... Fund, LLC"), never a vehicle that invests in it
 * (round 17: "HII Gecko Robotics Series I, a Series of Gecko Robotics, LLC"
 * and "Soma Capital Gecko Robotics SPV, LP" listed as Gecko raises).
 */
export function issuerIsCompany(issuer: string, names: string[], prefix?: string): boolean {
  const key = (n: string) => bareName(n.replace(/\s*\(CIK[^)]*\)/i, "")).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  if (names.some((n) => n && key(n) === key(issuer))) return true;
  if (!prefix || prefix.length < 3) return false;
  const own = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s.*\\b(fund|lp|l\\.p\\.)\\b`, "i");
  return own.test(issuer) && !/\b(spv|a series of)\b/i.test(issuer);
}

export function nameVariants(companyName: string): string[] {
  const bare = bareName(companyName);
  return [...new Set([companyName, bare, `${bare}, Inc.`, `${bare} LLC`])].filter(Boolean);
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
    // Same standard as every name-based registry (launch fix 40).
    .filter((r) => r.number && r.basic?.organization_name && strongNameMatch(r.basic.organization_name, companyName))
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
export function nlrbCase(r: { title: string; url: string; snippet?: string }, companyName: string, names: string[] = []): CaseRecord | undefined {
  const m = r.url.match(/nlrb\.gov\/case\/(\d{2}-[A-Z]{2}-\d+)/i);
  // The case page's title is the party: it must be the company itself.
  const party = r.title.split(/\s[|\-–—]\s/)[0];
  if (!m || !partyIs(party, [companyName, ...names])) return undefined;
  const filed = `${r.title} ${r.snippet ?? ""}`.match(/Date Filed:?\s*([0-9/]+|[A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  // "CA" cases are charges against an employer; "CB" against a union.
  const kind = m[1].toUpperCase().split("-")[1];
  const status = /\b(closed|settled|withdrawn|dismissed)\b/i.test(r.snippet ?? "") ? "closed" : /\bopen\b/i.test(r.snippet ?? "") ? "open" : undefined;
  return {
    caption: r.title.replace(/\s*\|\s*National Labor Relations Board.*$/i, "").trim(), court: "NLRB", docketNumber: m[1].toUpperCase(), filed, url: r.url,
    role: kind === "CA" ? "charged" : "unknown", caseType: kind === "CA" ? "Unfair labor practice charge against the employer" : "NLRB case", status,
  };
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

/** Franchise Disclosure Document figures, as published (launch fix 29). */
export interface FddFigures {
  year?: string;
  franchisorRevenue?: string;
  franchisorNetIncome?: string;
  averageUnitSales?: string;
  unitCount?: string;
  franchiseFee?: string;
  royalty?: string;
  initialInvestment?: string;
  /** Pages the figures came from. */
  urls: string[];
}

export class PublicFilingsAgent {
  constructor(private searcher: SearchProvider) {}

  /**
   * FDD figures for a franchisor (launch fix 29). State registries publish
   * FDDs, but behind search forms; the figures are found through search
   * (registry copies and articles quoting them) and read from those pages.
   */
  async fddFigures(companyName: string): Promise<{ fdd?: FddFigures; sources: Source[] }> {
    const results = (await Promise.all([
      this.searcher.search(`"${companyName}" franchise disclosure document Item 19 average sales`, 6),
      this.searcher.search(`"${companyName}" FDD franchisor revenue units initial investment`, 6),
    ])).flat();
    const seen = new Set<string>();
    const tied = results.filter((r) => !seen.has(r.url) && seen.add(r.url) && mentionsCompany(`${r.title} ${r.snippet ?? ""}`, companyName));
    if (tied.length === 0) return { sources: [] };
    const text = tied.map((r, i) => `[${i + 1}] ${r.title} (${r.url}): ${r.snippet ?? ""}`).join("\n");
    const r = await extractStructured(
      `From these search results about ${companyName}'s Franchise Disclosure Document (FDD), return one JSON object with only the figures the results state, each as written with its unit:
{"year": "<FDD year>", "franchisorRevenue": "...", "franchisorNetIncome": "...", "averageUnitSales": "<average or median gross sales per store, with any stated change>", "unitCount": "...", "franchiseFee": "...", "royalty": "...", "initialInvestment": "<range>", "sources": [<result numbers used>]}
Omit anything not stated. Never estimate.`,
      text, FddExtractionSchema);
    if (!r) return { sources: [] };
    const { sources: used, ...figures } = r;
    if (!Object.values(figures).some(Boolean)) return { sources: [] };
    const urls = (used.length ? used : [1]).map((n) => tied[n - 1]?.url).filter((u): u is string => !!u);
    return {
      fdd: { ...figures, urls },
      sources: urls.map((u) => source(u, `Franchise disclosure figures — ${companyName}`, "fdd")),
    };
  }

  /** @param names Other names it files under: legal name, short name (launch fixes 57, 60, 67). */
  async courtCases(companyName: string, names: string[] = []): Promise<{ cases: CaseRecord[]; sources: Source[] }> {
    // The name as searched and without its legal suffix, plus its legal
    // name, up to 3 pages each.
    const all = [...new Set([companyName, ...names].filter(Boolean))];
    // The distinctive core too, so subsidiaries match (launch fix 67:
    // "Limbach Company LLC" for Limbach Holdings); parties are checked below.
    const core = distinctiveWords(companyName).join(" ");
    const variants = [...new Set([companyName, bareName(companyName), ...(core.length >= 4 ? [core] : []), ...names.filter((n) => n.split(/\s+/).length > 1)])].slice(0, 5);
    // Courts misspell "Engineered" as "Engineering" (launch fix 67: ACCO v.
    // Noresco is captioned "ACCO Engineering Systems"). Matching already
    // treats them as one; the search has to ask for both.
    const respelled = variants.map(edIngVariant).filter((v): v is string => !!v && !variants.includes(v));
    variants.push(...respelled.slice(0, 2));
    const seen = new Set<string>();
    // One search over the case captions for every variant (launch fix 77:
    // nine parallel full-text searches hit CourtListener's rate limit and
    // timed out on 4 of 9 runs). Only parties count below anyway.
    const query = `caseName:(${variants.map((v) => `"${v.replace(/"/g, "")}"`).join(" OR ")})`;
    const run = await new CourtListenerAgent().run(query, 3);
    // A failed search is an error for the coverage table, not "none found".
    if (run.failed) throw new Error("CourtListener didn't answer");
    const records = run.records.filter((r) => !seen.has(r.url) && seen.add(r.url));
    const cases = records
      // A party by its exact name, never a namesake ("Patagonia Seafarms").
      .filter((r) => namedParty(r.caseName, all))
      .map((r) => ({ caption: r.caseName, court: r.court, docketNumber: r.docketNumber, filed: r.dateFiled, url: r.url, ...caseContext(r, all) }));
    return { cases, sources: cases.map((c) => source(c.url, `CourtListener — ${c.caption}`, "court-records")) };
  }

  async nlrbCases(companyName: string, names: string[] = []): Promise<{ cases: CaseRecord[]; sources: Source[] }> {
    // The legal name too: one search by the short name found Graybar's two
    // cases in one run and none in the next (round 17).
    const queries = [...new Set([companyName, ...names.filter((n) => n.length > companyName.length)].slice(0, 2))];
    const batches = await Promise.all(queries.map((q) => this.searcher.search(`site:nlrb.gov/case "${q}"`, 8)));
    const seen = new Set<string>();
    const cases = batches.flat().filter((r) => !seen.has(r.url) && !!seen.add(r.url))
      .map((r) => nlrbCase(r, companyName, names)).filter((c): c is CaseRecord => !!c);
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

  /** @param prefix The company's short name: its funds file as "<prefix> ... Fund I, LLC"
   *  (launch fix 47: MJW's funds), searched once as a plain word. */
  async formDFilings(names: string[], prefix?: string): Promise<{ funding: FundingEntry[]; sources: Source[] }> {
    const funding: FundingEntry[] = [];
    const sources: Source[] = [];
    const seen = new Set<string>();
    const queries: { q: string; accepts: (display: string) => boolean }[] = names.slice(0, 8).map((name) => ({ q: `"${name}"`, accepts: (d: string) => mentionsCompany(d, name) }));
    if (prefix && prefix.length >= 3) {
      const starts = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s.*\\b(fund|lp|l\\.p\\.)\\b`, "i");
      queries.push({ q: `"${prefix}" fund`, accepts: (d) => starts.test(d.replace(/\s*\(CIK[^)]*\)/i, "")) });
    }
    let answered = 0;
    for (const { q, accepts } of queries) {
      const data = await secJson<EftsResponse>(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=D`);
      if (data) answered++;
      const name = q.replace(/"/g, "");
      for (const hit of (data?.hits?.hits ?? []).slice(0, 3)) {
        const s = hit._source;
        const cik = s?.ciks?.[0]?.replace(/^0+/, "");
        const adsh = s?.adsh ?? hit._id?.split(":")[0];
        if (!cik || !adsh || seen.has(adsh)) continue;
        if (!(s?.display_names ?? []).some(accepts)) continue;
        seen.add(adsh);
        const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}`;
        const xml = await secText(`${folder}/primary_doc.xml`);
        const d = xml ? parseFormD(xml) : {};
        const issuer = d.issuer ?? s?.display_names?.[0]?.replace(/\s*\(CIK.*$/, "") ?? name;
        if (!issuerIsCompany(issuer, names, prefix)) { console.log(`[form-d] skipped "${issuer}": not the company as issuer`); continue; }
        funding.push({
          round: `Form D: ${issuer}`,
          amount: d.sold ? `${d.sold} sold${d.offered ? ` of ${d.offered} offered` : ""}` : d.offered ? `${d.offered} offered` : undefined,
          date: s?.file_date,
          url: `${folder}/`,
        });
        sources.push(source(`${folder}/`, `SEC Form D — ${issuer}${s?.file_date ? ` (${s.file_date})` : ""}`, "funding"));
      }
    }
    // No query answered: an error, never "no Form D filings" (launch fix 54).
    if (answered === 0 && queries.length) throw new Error("SEC full-text search refused or failed every query");
    return { funding, sources };
  }
}

function source(url: string, title: string, usedFor: string): Source {
  return { url, title, retrievedAt: new Date().toISOString(), usedFor: [usedFor] };
}

/** "ACCO Engineered Systems" -> "ACCO Engineering Systems" and back; undefined when no word swaps. */
export function edIngVariant(name: string): string | undefined {
  let changed = false;
  const out = name.replace(/\b([A-Za-z]{4,})(ed|ing)\b/g, (w, stem: string, end: string) => {
    if (w.length < 7) return w;
    changed = true;
    return `${stem}${end.toLowerCase() === "ed" ? "ing" : "ed"}`;
  });
  return changed ? out : undefined;
}
