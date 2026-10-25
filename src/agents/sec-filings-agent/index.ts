import type { Source } from "../../types/research.js";
import { htmlToFullText } from "../../lib/providers.js";
import { secJson, secText } from "../../lib/sec-http.js";
import { EarningsExtractionSchema, extractAnalysis, ProxyExtractionSchema, TenKExtractionSchema } from "../../lib/llm.js";
import { mentionsCompany } from "../../lib/news-noise.js";

/**
 * SEC filings, parsed (launch fix 19). Finding a filing isn't enough: a
 * company that files a 10-K has its financials, officers, risks and
 * lawsuits on the record. Pure public APIs:
 *
 *   EDGAR full-text search   the company's CIK, from its own filings
 *   submissions API          every filing, state of incorporation, address
 *   XBRL company facts       revenue, net income, gross margin by fiscal year
 *   latest 10-K              business, risk factors, legal proceedings,
 *                            executive officers (one model call on excerpts)
 *   latest DEF 14A/14C       board composition and independence
 *   latest 10-Q facts        the newest quarter against the same quarter
 *                            a year earlier (launch fix 33)
 *   latest 8-K, item 2.02    the earnings release: results and guidance
 *
 * Fails open: anything that can't be read is left out, never guessed.
 */


export interface FiscalYear {
  /** "2025" */
  year: string;
  /** Period end, "2025-12-31". */
  end: string;
  revenue?: number;
  netIncome?: number;
  /** Gross profit / revenue, 0-1. */
  grossMargin?: number;
}

/** The newest reported quarter next to the same quarter a year earlier. */
export interface QuarterCompare {
  /** "Q2 2026" */
  label: string;
  end: string;
  revenue?: number;
  grossMargin?: number;
  priorRevenue?: number;
  priorGrossMargin?: number;
}

export interface EarningsRelease {
  date: string;
  url: string;
  period?: string;
  highlights: string[];
  /** Guidance as stated, including any change from the last guidance. */
  guidance?: string;
}

export interface SecFilings {
  cik: string;
  name: string;
  /** Two-letter state, "NY". */
  stateOfIncorporation?: string;
  /** Business address from the filings, "Clayton, MO". */
  businessAddress?: string;
  financials: FiscalYear[];
  latestQuarter?: QuarterCompare;
  earnings?: EarningsRelease;
  description?: string;
  founded?: string;
  incorporatedYear?: string;
  employees?: string;
  /** Companies the 10-K names as competitors (launch fix 42). */
  competitors?: string[];
  riskFactors: string[];
  legalProceedings?: string;
  executiveOfficers: { name: string; title: string }[];
  board?: { directors: { name: string; independent?: boolean }[]; independence?: string };
  /** The 10-K and proxy the text came from. */
  tenKUrl?: string;
  tenKDate?: string;
  proxyUrl?: string;
}


// Under the coverage recorder's 90s, with room to spare.
const SEC_BUDGET_MS = 80_000;

const pad = (cik: string) => cik.replace(/^0+/, "").padStart(10, "0");

interface EftsHit { _source?: { ciks?: string[]; display_names?: string[]; form?: string } }

/** The CIK whose filer name is this company, from a full-text search hit. */
export function cikFromSearch(hits: EftsHit[], companyName: string): string | undefined {
  for (const h of hits) {
    const names = h._source?.display_names ?? [];
    // "Limbach Holdings, Inc.  (LMB)  (CIK 0001606163)": ticker and CIK off.
    const filer = (n: string) => n.replace(/\s*\((CIK[^)]*|[A-Z0-9.,\s-]{1,20})\)/g, "").trim();
    const i = names.findIndex((n) => mentionsCompany(filer(n), companyName)
      || mentionsCompany(filer(n), companyName.replace(/\b(company|corporation|inc\.?|co\.?)$/i, "").trim()));
    if (i >= 0) return h._source?.ciks?.[i] ?? h._source?.ciks?.[0];
  }
  return undefined;
}

interface TickerRow { cik_str?: number; ticker?: string; title?: string }

const SUFFIX = /[,.]?\s+(inc|incorporated|corp|corporation|co|company|holdings|group|ltd|plc|llc)\.?$/i;
const core = (n: string) => {
  let out = n.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== out;) { prev = out; out = out.replace(SUFFIX, "").trim(); }
  return out;
};

/**
 * The CIK from SEC's ticker list, by name (launch fix 33): when full-text
 * search returns nothing usable, a listed company is still on this list.
 * Names match once legal suffixes are off ("Limbach Holdings, Inc." and
 * "Limbach").
 */
export function cikFromTickers(rows: TickerRow[], companyName: string): string | undefined {
  const want = core(companyName);
  if (!want) return undefined;
  const hit = rows.find((r) => r.title && core(r.title) === want)
    ?? rows.find((r) => r.title && core(r.title).startsWith(`${want} `) && want.split(" ").length >= 2);
  return hit?.cik_str !== undefined ? String(hit.cik_str) : undefined;
}

const bareCompany = (n: string) => n.replace(/[,.]?\s+(inc|incorporated|corp|corporation|co|company|llc|ltd)\.?$/i, "").trim();

/**
 * The CIK from EDGAR's company search (atom or the HTML company list):
 * a filer whose conformed name is this company.
 */
export function cikFromBrowse(text: string, companyName: string): string | undefined {
  const pairs: [string, string][] = [];
  const one = text.match(/<cik>(\d+)<\/cik>/i);
  const conformed = text.match(/<conformed-name>([^<]+)<\/conformed-name>/i);
  if (one && conformed) pairs.push([one[1], conformed[1]]);
  for (const m of text.matchAll(/CIK=(\d{10})[^>]*>\s*\d{10}\s*<\/a>\s*<\/td>\s*<td[^>]*>([^<]+)/gi)) pairs.push([m[1], m[2]]);
  const want = core(companyName);
  const hit = pairs.find(([, n]) => core(n.replace(/&amp;/g, "&")) === want)
    ?? pairs.find(([, n]) => mentionsCompany(n.replace(/&amp;/g, "&"), bareCompany(companyName)));
  return hit?.[0];
}

interface Submissions {
  name?: string;
  website?: string;
  investorWebsite?: string;
  stateOfIncorporation?: string;
  addresses?: { business?: { city?: string; stateOrCountry?: string } };
  filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; primaryDocument?: string[]; items?: string[] } };
}

/**
 * The filer is the business at this domain (round 17: Patagonia's report
 * read the 10-K of Patagonia Gold Corp, an Argentine miner, matched by
 * name). The SEC's own record of its website, or the domain in its 10-K,
 * which states the company's internet address.
 */
export function filerIsDomain(domain: string, sub: Pick<Submissions, "website" | "investorWebsite">, tenKHtml?: string | null): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  const host = (u?: string) => { try { return new URL(/^https?:/i.test(u ?? "") ? u! : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
  if ([sub.website, sub.investorWebsite].some((u) => { const h = host(u); return !!h && (h === d || h.endsWith(`.${d}`)); })) return true;
  return !!tenKHtml && new RegExp(`(^|[^a-z0-9-])${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-])`, "i").test(tenKHtml);
}

/** A filer the website check couldn't confirm, for the caller to check against the site. */
export interface SecCandidate { cik: string; name: string; city?: string; state?: string }

const LEGAL_SUFFIX = /\b(inc|incorporated|co|company|corp|corporation|llc|ltd|plc)\b\.?/g;
const legalKey = (n: string) => n.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();

/**
 * A filer the site names as itself (round 18: Graybar, employee-owned with
 * no ticker, lost its 10-K data under the website check). Its legal name
 * must be the site's legal name ("Graybar Electric Company" and "GRAYBAR
 * ELECTRIC CO INC") and its business address the site's headquarters city
 * and state (Clayton, MO). A name alone never confirms: Patagonia, Inc. is
 * not Patagonia Gold Corp.
 */
export function filerMatchesSite(c: SecCandidate, legalName: string | undefined, headquarters: string | undefined, states: Record<string, string>): boolean {
  if (!legalName || !headquarters || !c.city || !c.state || legalKey(legalName) !== legalKey(c.name)) return false;
  const parts = headquarters.split(",").map((p) => p.trim().toLowerCase());
  const abbr = (x: string) => Object.entries(states).find(([k, v]) => k.toLowerCase() === x || v.toLowerCase() === x)?.[0].toLowerCase();
  const state = parts.slice(1).map(abbr).find(Boolean);
  return parts[0] === c.city.toLowerCase() && !!state && state === c.state.toLowerCase();
}

/** The year a 10-K says the company was incorporated, unless it's the report's own year: a misread (round 18: Limbach "2025, DE"). */
export function plausibleIncorporated(year: string | undefined, tenKDate: string): string | undefined {
  const filed = Number(tenKDate.slice(0, 4));
  return year && Number(year) < filed - 1 ? year : undefined;
}

// "Latest results" and summary facts come only from recent filings (round
// 17: Graybar's 2019-2020 results showed as its latest).
const RECENT_MS = 2 * 365 * 86_400_000;
export const recentFiling = (date: string | undefined, now = Date.now()) => { const t = Date.parse(date ?? ""); return !isNaN(t) && t >= now - RECENT_MS; };

/** Newest 8-K reporting results (item 2.02): its folder and date. */
export function latestEarnings8K(sub: Submissions, cik: string): { folder: string; date: string } | undefined {
  const r = sub.filings?.recent;
  if (!r?.form) return undefined;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== "8-K" || !(r.items?.[i] ?? "").split(",").includes("2.02")) continue;
    const acc = r.accessionNumber?.[i];
    if (!acc) continue;
    return { folder: `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, "")}/${acc.replace(/-/g, "")}`, date: r.filingDate?.[i] ?? "" };
  }
  return undefined;
}

/** The press release exhibit (99.1) in an 8-K folder listing. */
export function pressReleaseFile(items: { name?: string }[]): string | undefined {
  const htm = items.map((i) => i.name ?? "").filter((n) => /\.html?$/i.test(n));
  return htm.find((n) => /ex-?99[-_.]?0?1\b|ex991|exhibit-?99-?1/i.test(n)) ?? htm.find((n) => /ex-?99/i.test(n));
}

/** Release text for the model: the opening (the results) and the outlook. */
export function releaseExcerpt(html: string, max = 6000): string {
  const text = htmlToFullText(html);
  const head = text.slice(0, 3500);
  const at = text.search(/\b(guidance|outlook)\b/i);
  const outlook = at > 3500 ? text.slice(Math.max(0, at - 200), at + 2300) : "";
  return [head, outlook].filter(Boolean).join("\n...\n").slice(0, max);
}

/** Newest filing of one of these forms: its document URL and date. */
export function latestFiling(sub: Submissions, cik: string, forms: string[]): { url: string; date: string } | undefined {
  const r = sub.filings?.recent;
  if (!r?.form) return undefined;
  for (let i = 0; i < r.form.length; i++) {
    if (!forms.includes(r.form[i])) continue;
    const acc = r.accessionNumber?.[i];
    const doc = r.primaryDocument?.[i];
    if (!acc || !doc) continue;
    return { url: `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, "")}/${acc.replace(/-/g, "")}/${doc}`, date: r.filingDate?.[i] ?? "" };
  }
  return undefined;
}

interface FactUnit { start?: string; end?: string; val?: number; fy?: number; fp?: string; form?: string; filed?: string }
interface CompanyFacts { facts?: Record<string, Record<string, { units?: Record<string, FactUnit[]> }>> }

const REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"];
const COST = ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"];

/** Full-year values of the first concept that has any, keyed by period end. */
function annual(facts: CompanyFacts, concepts: string[]): Map<string, number> {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  for (const c of concepts) {
    const units = gaap[c]?.units?.USD;
    if (!units?.length) continue;
    const out = new Map<string, { val: number; filed: string }>();
    for (const u of units) {
      if (u.val === undefined || !u.end || !u.start || !/^10-K/.test(u.form ?? "")) continue;
      const days = (Date.parse(u.end) - Date.parse(u.start)) / 86_400_000;
      if (days < 350 || days > 380) continue;
      const prev = out.get(u.end);
      // A later filing restates the year: the newest value wins.
      if (!prev || (u.filed ?? "") > prev.filed) out.set(u.end, { val: u.val, filed: u.filed ?? "" });
    }
    if (out.size) return new Map([...out].map(([k, v]) => [k, v.val]));
  }
  return new Map();
}

/** The last three fiscal years: revenue, net income and gross margin. */
export function fiscalYears(facts: CompanyFacts): FiscalYear[] {
  const revenue = annual(facts, REVENUE);
  const income = annual(facts, ["NetIncomeLoss"]);
  const gross = annual(facts, ["GrossProfit"]);
  const cost = annual(facts, COST);
  return [...revenue.keys()].sort().reverse().slice(0, 3).map((end) => {
    const rev = revenue.get(end)!;
    const gp = gross.get(end) ?? (cost.has(end) ? rev - cost.get(end)! : undefined);
    return { year: end.slice(0, 4), end, revenue: rev, netIncome: income.get(end), grossMargin: gp !== undefined && rev ? gp / rev : undefined };
  });
}

/** Quarter-length values of the first concept that has any, keyed by period end. */
function quarterly(facts: CompanyFacts, concepts: string[]): Map<string, FactUnit> {
  const gaap = facts.facts?.["us-gaap"] ?? {};
  for (const c of concepts) {
    const units = gaap[c]?.units?.USD;
    if (!units?.length) continue;
    const out = new Map<string, FactUnit>();
    for (const u of units) {
      if (u.val === undefined || !u.end || !u.start || !/^10-[QK]/.test(u.form ?? "")) continue;
      const days = (Date.parse(u.end) - Date.parse(u.start)) / 86_400_000;
      if (days < 80 || days > 100) continue;
      const prev = out.get(u.end);
      if (!prev || (u.filed ?? "") > (prev.filed ?? "")) out.set(u.end, u);
    }
    if (out.size) return out;
  }
  return new Map();
}

/**
 * The newest quarter against the same quarter a year earlier (launch fix
 * 33: Limbach's Q2 2026 gross margin fell from 28.0% to 21.5%).
 */
export function latestQuarter(facts: CompanyFacts): QuarterCompare | undefined {
  const revenue = quarterly(facts, REVENUE);
  if (revenue.size === 0) return undefined;
  const gross = quarterly(facts, ["GrossProfit"]);
  const cost = quarterly(facts, COST);
  const end = [...revenue.keys()].sort().reverse()[0];
  const margin = (e: string) => {
    const rev = revenue.get(e)?.val;
    const gp = gross.get(e)?.val ?? (rev !== undefined && cost.has(e) ? rev - cost.get(e)!.val! : undefined);
    return gp !== undefined && rev ? gp / rev : undefined;
  };
  // The same quarter a year earlier: an end date 365 days back, give or take.
  const prior = [...revenue.keys()].find((e) => Math.abs(Date.parse(end) - Date.parse(e) - 365 * 86_400_000) < 20 * 86_400_000);
  const u = revenue.get(end)!;
  const label = u.fp && /^Q[1-4]$/.test(u.fp) && u.fy ? `${u.fp} ${u.fy}` : `Quarter ended ${end}`;
  return {
    label, end, revenue: u.val, grossMargin: margin(end),
    priorRevenue: prior ? revenue.get(prior)?.val : undefined, priorGrossMargin: prior ? margin(prior) : undefined,
  };
}

/**
 * A 10-K section's body: of every place the heading appears (the table of
 * contents lists them too), the one followed by the most text before the
 * next heading.
 */
export function sectionText(text: string, start: RegExp, end: RegExp, max = 4000): string | undefined {
  let best = "";
  for (const m of text.matchAll(new RegExp(start.source, "gi"))) {
    const from = (m.index ?? 0) + m[0].length;
    const rest = text.slice(from);
    const stop = rest.search(new RegExp(end.source, "i"));
    const body = (stop === -1 ? rest.slice(0, max * 3) : rest.slice(0, stop)).trim();
    if (body.length > best.length) best = body;
  }
  return best.length > 200 ? best.slice(0, max) : undefined;
}

export function tenKExcerpts(html: string): { business?: string; competition?: string; risks?: string; legal?: string; officers?: string } {
  const text = htmlToFullText(html);
  // The competition passage sits deep in Item 1: the first "Competition"
  // heading or sentence about competitors in the whole business section.
  const businessAll = sectionText(text, /item\s*1\.?\s*business\b/, /item\s*1a\.?\s*risk factors/, 80_000) ?? "";
  const at = businessAll.search(/\bCompetition\b|\bcompetitors (include|are)\b|\bcompete (primarily |principally )?with\b/);
  return {
    competition: at >= 0 ? businessAll.slice(at, at + 1800) : undefined,
    business: sectionText(text, /item\s*1\.?\s*business\b/, /item\s*1a\.?\s*risk factors/, 3500),
    risks: sectionText(text, /item\s*1a\.?\s*risk factors/, /item\s*1b\.?|item\s*1c\.?|item\s*2\.?\s*properties/, 4000),
    legal: sectionText(text, /item\s*3\.?\s*legal proceedings/, /item\s*4\.?/, 2500),
    officers: sectionText(text, /(?:information about (?:our |the company'?s |the registrant'?s )?executive officers|executive officers of the (?:registrant|company))/, /part\s*ii\b|item\s*5\.?/, 2500),
  };
}

/** Passages of a proxy statement about director independence and the board. */
export function proxyExcerpts(html: string, max = 5000): string {
  const text = htmlToFullText(html);
  const windows: string[] = [];
  let last = -Infinity;
  for (const m of text.matchAll(/independen(t|ce)/gi)) {
    const at = m.index ?? 0;
    if (at < last + 700) continue;
    last = at;
    windows.push(text.slice(Math.max(0, at - 300), at + 500));
    if (windows.length >= 8) break;
  }
  return windows.join("\n...\n").slice(0, max);
}

export class SecFilingsAgent {
  /**
   * Launch fix 41: Graybar and Limbach still showed no financials. Every
   * step now has a share of one time budget, under the 90s the coverage
   * recorder allows, so a slow 10-K read can't take the XBRL figures down
   * with it; the CIK comes from whichever of three lookups answers; and
   * each step logs what it got.
   */
  /** @param domain The business's own website: the CIK must be confirmed
   *  against it (round 17). Without one, only an exact name on the SEC's
   *  ticker list counts. */
  async run(companyName: string, domain?: string, confirmedCik?: string): Promise<{ filings?: SecFilings; sources: Source[]; unconfirmed?: SecCandidate[] }> {
    const deadline = Date.now() + SEC_BUDGET_MS;
    const within = <T>(p: Promise<T>, fallback: T): Promise<T> => {
      const left = deadline - Date.now();
      if (left <= 0) return Promise.resolve(fallback);
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([p, new Promise<T>((r) => { timer = setTimeout(() => r(fallback), left); })]).finally(() => clearTimeout(timer));
    };

    const [search, browse, tickers] = await Promise.all([
      secJson<{ hits?: { hits?: EftsHit[] } }>(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${companyName}"`)}&forms=10-K`),
      secText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(bareCompany(companyName))}&type=10-K&dateb=&owner=include&count=40&output=atom`),
      secJson<Record<string, TickerRow>>("https://www.sec.gov/files/company_tickers.json"),
    ]);
    const viaSearch = cikFromSearch(search?.hits?.hits ?? [], companyName);
    const viaBrowse = browse ? cikFromBrowse(browse, companyName) : undefined;
    const viaTickers = tickers ? cikFromTickers(Object.values(tickers), companyName) : undefined;
    console.log(`[sec-filings] "${companyName}": CIK by full-text ${search ? (viaSearch ?? "none") : "failed"}, by company search ${browse ? (viaBrowse ?? "none") : "failed"}, by ticker list ${tickers ? (viaTickers ?? "none") : "failed"}`);
    // Every lookup refused or failed: an error for the coverage table, never
    // "no filings" (launch fix 54).
    if (!search && !browse && !tickers) throw new Error("SEC EDGAR refused or failed every lookup");

    // Each candidate is confirmed before anything is read from it, the ticker
    // list's exact name first; none confirmed means no SEC data, never
    // another company's (round 17: Patagonia read Patagonia Gold Corp's 10-K).
    // A CIK the caller already confirmed (by legal name and headquarters) is read as is.
    const candidates = confirmedCik ? [confirmedCik.replace(/^0+/, "")]
      : [...new Set([viaTickers, viaSearch, viaBrowse].filter((c): c is string => !!c).map((c) => c.replace(/^0+/, "")))];
    const unconfirmed: SecCandidate[] = [];
    let found: { cik: string; sub: Submissions; facts: CompanyFacts | null; tenKFiling?: { url: string; date: string }; tenKHtml: string | null } | undefined;
    for (const cik of candidates) {
      const [sub, facts] = await Promise.all([
        secJson<Submissions>(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`),
        secJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`),
      ]);
      if (!sub) throw new Error(`SEC submissions for CIK ${cik} couldn't be read`);
      const tenKFiling = latestFiling(sub, cik, ["10-K", "10-K405"]);
      const tenKHtml = !confirmedCik && domain && tenKFiling && !filerIsDomain(domain, sub) ? await within(secText(tenKFiling.url), null) : null;
      if (confirmedCik || (domain ? filerIsDomain(domain, sub, tenKHtml) : cik === viaTickers?.replace(/^0+/, ""))) { found = { cik, sub, facts, tenKFiling, tenKHtml }; break; }
      const biz = sub.addresses?.business;
      unconfirmed.push({ cik, name: sub.name ?? "", city: biz?.city, state: biz?.stateOrCountry });
      console.log(`[sec-filings] "${companyName}": CIK ${cik} (${sub.name ?? "?"}) not confirmed against ${domain ?? "the ticker list's exact name"}`);
    }
    if (!found) return { sources: [], unconfirmed };
    const { cik, sub, facts, tenKFiling, tenKHtml } = found;

    const biz = sub.addresses?.business;
    const filings: SecFilings = {
      cik: cik.replace(/^0+/, ""),
      name: sub.name ?? companyName,
      stateOfIncorporation: sub.stateOfIncorporation || undefined,
      businessAddress: biz?.city ? `${biz.city.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())}${biz.stateOrCountry ? `, ${biz.stateOrCountry}` : ""}` : undefined,
      financials: facts ? fiscalYears(facts) : [],
      latestQuarter: facts ? [latestQuarter(facts)].find((q) => q && recentFiling(q.end)) : undefined,
      riskFactors: [],
      executiveOfficers: [],
    };
    const edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filings.cik}`;
    const sources: Source[] = [{ url: edgarUrl, title: `SEC EDGAR filings — ${filings.name}`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] }];
    if (filings.financials.length || filings.latestQuarter) {
      sources.push({ url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`, title: `SEC XBRL financial data — ${filings.name}`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] });
    }

    const tenK = tenKFiling;
    const proxy = latestFiling(sub, cik, ["DEF 14A", "DEF 14C"]);
    const release = [latestEarnings8K(sub, cik)].find((r) => r && recentFiling(r.date));
    if (tenK) {
      filings.tenKUrl = tenK.url;
      filings.tenKDate = tenK.date;
      sources.push({ url: tenK.url, title: `${filings.name} annual report (10-K, ${tenK.date})`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings", "leadership"] });
    }

    // The three reads run side by side, each fetching its document and
    // asking the model once; whatever isn't back by the deadline is left out.
    const readTenK = async () => {
      const html = tenK ? tenKHtml ?? await secText(tenK.url) : null;
      if (!tenK || !html) return;
      const x = tenKExcerpts(html);
      const input = [
        x.business && `BUSINESS:\n${x.business}`,
        x.competition && `COMPETITION:\n${x.competition}`,
        x.risks && `RISK FACTORS:\n${x.risks}`,
        x.legal && `LEGAL PROCEEDINGS:\n${x.legal}`,
        x.officers && `EXECUTIVE OFFICERS:\n${x.officers}`,
      ].filter(Boolean).join("\n\n");
      if (!input) return;
      const r = await extractAnalysis(
        `You read excerpts of ${filings.name}'s latest annual report (10-K, filed ${tenK.date}). Return one JSON object:
{"description": "<2 sentences: what the company does and for whom>", "founded": "<year the business was founded, if stated>", "incorporatedYear": "<year incorporated, if stated>", "employees": "<employee count as stated>", "competitors": ["<each company the report names as a competitor>"], "riskFactors": ["<one line per material risk factor, at most 8, most specific first>"], "legalProceedings": "<1-3 sentences with the numbers stated, e.g. how many asbestos suits are pending>", "executiveOfficers": [{"name": "...", "title": "..."}]}
Only what the excerpts state. Omit a field the excerpts don't give.`,
        input, TenKExtractionSchema);
      if (r) {
        Object.assign(filings, {
          description: r.description, founded: r.founded, incorporatedYear: plausibleIncorporated(r.incorporatedYear, tenK.date), employees: r.employees,
          riskFactors: r.riskFactors.slice(0, 8), legalProceedings: r.legalProceedings, executiveOfficers: r.executiveOfficers,
          competitors: r.competitors.slice(0, 10),
        });
      }
    };
    const readProxy = async () => {
      const html = proxy ? await secText(proxy.url) : null;
      const passages = proxy && html ? proxyExcerpts(html) : "";
      if (!proxy || !passages) return;
      const r = await extractAnalysis(
        `You read passages of ${filings.name}'s proxy or information statement (filed ${proxy.date}) about its board. Return one JSON object:
{"directors": [{"name": "...", "independent": true}], "independence": "<1-2 sentences on how many directors are independent and any stated exception, e.g. directors who are also employees>"}
Only what the passages state.`,
        passages, ProxyExtractionSchema);
      if (r && (r.directors.length || r.independence)) {
        filings.board = { directors: r.directors, independence: r.independence };
        filings.proxyUrl = proxy.url;
        sources.push({ url: proxy.url, title: `${filings.name} proxy statement (${proxy.date})`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] });
      }
    };
    const readEarnings = async () => {
      const e = release ? await this.earnings(release, filings.name) : undefined;
      if (!e) return;
      filings.earnings = e;
      sources.push({ url: e.url, title: `${filings.name} earnings release (8-K, ${e.date})`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] });
    };
    const done = await Promise.all([readTenK, readProxy, readEarnings].map((f) => within(f().then(() => true, () => false), false)));

    console.log(`[sec-filings] "${companyName}": CIK ${filings.cik}, ${filings.financials.length} fiscal year(s), quarter ${filings.latestQuarter?.label ?? "none"}, 10-K ${tenK ? (done[0] && filings.description ? "read" : "not read in time") : "none"}, proxy ${filings.board ? "read" : "none"}, earnings ${filings.earnings ? "read" : "none"}`);
    return { filings, sources };
  }

  /** The latest earnings release, read for results and guidance. */
  private async earnings(release: { folder: string; date: string }, name: string): Promise<EarningsRelease | undefined> {
    const index = await secJson<{ directory?: { item?: { name?: string }[] } }>(`${release.folder}/index.json`);
    const file = pressReleaseFile(index?.directory?.item ?? []);
    if (!file) return undefined;
    const url = `${release.folder}/${file}`;
    const html = await secText(url);
    if (!html) return undefined;
    const r = await extractAnalysis(
      `You read ${name}'s earnings press release (8-K, filed ${release.date}). Return one JSON object:
{"period": "<the quarter or year reported, e.g. Q2 2026>", "highlights": ["<one line per headline result with its figure and the comparison stated, e.g. gross margin 21.5% vs 28.0% a year earlier; at most 5>"], "guidance": "<1-2 sentences: the outlook as stated, saying which figures were raised, cut or kept>"}
Only what the release states. Omit guidance if it gives none.`,
      releaseExcerpt(html), EarningsExtractionSchema);
    if (!r || (!r.highlights.length && !r.guidance)) return undefined;
    return { date: release.date, url, period: r.period, highlights: r.highlights.slice(0, 5), guidance: r.guidance };
  }
}
