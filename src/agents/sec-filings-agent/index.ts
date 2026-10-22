import type { Source } from "../../types/research.js";
import { htmlToFullText } from "../../lib/providers.js";
import { extractStructured, ProxyExtractionSchema, TenKExtractionSchema } from "../../lib/llm.js";
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
 *
 * Fails open: anything that can't be read is left out, never guessed.
 */

// SEC asks automated clients to identify themselves.
const SEC_UA = "Metis Research support@metisanalytic.com";

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

export interface SecFilings {
  cik: string;
  name: string;
  /** Two-letter state, "NY". */
  stateOfIncorporation?: string;
  /** Business address from the filings, "Clayton, MO". */
  businessAddress?: string;
  financials: FiscalYear[];
  description?: string;
  founded?: string;
  incorporatedYear?: string;
  employees?: string;
  riskFactors: string[];
  legalProceedings?: string;
  executiveOfficers: { name: string; title: string }[];
  board?: { directors: { name: string; independent?: boolean }[]; independence?: string };
  /** The 10-K and proxy the text came from. */
  tenKUrl?: string;
  tenKDate?: string;
  proxyUrl?: string;
}

async function secJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": SEC_UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.warn(`[sec-filings] ${new URL(url).pathname} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[sec-filings] ${url.split("?")[0]} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function secText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": SEC_UA }, signal: AbortSignal.timeout(30_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const pad = (cik: string) => cik.replace(/^0+/, "").padStart(10, "0");

interface EftsHit { _source?: { ciks?: string[]; display_names?: string[]; form?: string } }

/** The CIK whose filer name is this company, from a full-text search hit. */
export function cikFromSearch(hits: EftsHit[], companyName: string): string | undefined {
  for (const h of hits) {
    const names = h._source?.display_names ?? [];
    const i = names.findIndex((n) => mentionsCompany(n.replace(/\s*\(CIK[^)]*\)/i, ""), companyName)
      || mentionsCompany(n.replace(/\s*\(CIK[^)]*\)/i, ""), companyName.replace(/\b(company|corporation|inc\.?|co\.?)$/i, "").trim()));
    if (i >= 0) return h._source?.ciks?.[i] ?? h._source?.ciks?.[0];
  }
  return undefined;
}

interface Submissions {
  name?: string;
  stateOfIncorporation?: string;
  addresses?: { business?: { city?: string; stateOrCountry?: string } };
  filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; primaryDocument?: string[] } };
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

export function tenKExcerpts(html: string): { business?: string; risks?: string; legal?: string; officers?: string } {
  const text = htmlToFullText(html);
  return {
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
  async run(companyName: string): Promise<{ filings?: SecFilings; sources: Source[] }> {
    const search = await secJson<{ hits?: { hits?: EftsHit[] } }>(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${companyName}"`)}&forms=10-K`);
    const cik = cikFromSearch(search?.hits?.hits ?? [], companyName);
    if (!cik) return { sources: [] };
    const [sub, facts] = await Promise.all([
      secJson<Submissions>(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`),
      secJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`),
    ]);
    if (!sub) return { sources: [] };

    const biz = sub.addresses?.business;
    const filings: SecFilings = {
      cik: cik.replace(/^0+/, ""),
      name: sub.name ?? companyName,
      stateOfIncorporation: sub.stateOfIncorporation || undefined,
      businessAddress: biz?.city ? `${biz.city.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())}${biz.stateOrCountry ? `, ${biz.stateOrCountry}` : ""}` : undefined,
      financials: facts ? fiscalYears(facts) : [],
      riskFactors: [],
      executiveOfficers: [],
    };
    const edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filings.cik}`;
    const sources: Source[] = [{ url: edgarUrl, title: `SEC EDGAR filings — ${filings.name}`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] }];
    if (filings.financials.length) {
      sources.push({ url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`, title: `SEC XBRL financial data — ${filings.name}`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] });
    }

    const tenK = latestFiling(sub, cik, ["10-K", "10-K405"]);
    const proxy = latestFiling(sub, cik, ["DEF 14A", "DEF 14C"]);
    const [tenKHtml, proxyHtml] = await Promise.all([
      tenK ? secText(tenK.url) : Promise.resolve(null),
      proxy ? secText(proxy.url) : Promise.resolve(null),
    ]);

    if (tenK && tenKHtml) {
      const x = tenKExcerpts(tenKHtml);
      const input = [
        x.business && `BUSINESS:\n${x.business}`,
        x.risks && `RISK FACTORS:\n${x.risks}`,
        x.legal && `LEGAL PROCEEDINGS:\n${x.legal}`,
        x.officers && `EXECUTIVE OFFICERS:\n${x.officers}`,
      ].filter(Boolean).join("\n\n");
      if (input) {
        const r = await extractStructured(
          `You read excerpts of ${filings.name}'s latest annual report (10-K, filed ${tenK.date}). Return one JSON object:
{"description": "<2 sentences: what the company does and for whom>", "founded": "<year the business was founded, if stated>", "incorporatedYear": "<year incorporated, if stated>", "employees": "<employee count as stated>", "riskFactors": ["<one line per material risk factor, at most 8, most specific first>"], "legalProceedings": "<1-3 sentences with the numbers stated, e.g. how many asbestos suits are pending>", "executiveOfficers": [{"name": "...", "title": "..."}]}
Only what the excerpts state. Omit a field the excerpts don't give.`,
          input, TenKExtractionSchema);
        if (r) {
          Object.assign(filings, {
            description: r.description, founded: r.founded, incorporatedYear: r.incorporatedYear, employees: r.employees,
            riskFactors: r.riskFactors.slice(0, 8), legalProceedings: r.legalProceedings, executiveOfficers: r.executiveOfficers,
          });
        }
      }
      filings.tenKUrl = tenK.url;
      filings.tenKDate = tenK.date;
      sources.push({ url: tenK.url, title: `${filings.name} annual report (10-K, ${tenK.date})`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings", "leadership"] });
    }

    if (proxy && proxyHtml) {
      const passages = proxyExcerpts(proxyHtml);
      if (passages) {
        const r = await extractStructured(
          `You read passages of ${filings.name}'s proxy or information statement (filed ${proxy.date}) about its board. Return one JSON object:
{"directors": [{"name": "...", "independent": true}], "independence": "<1-2 sentences on how many directors are independent and any stated exception, e.g. directors who are also employees>"}
Only what the passages state.`,
          passages, ProxyExtractionSchema);
        if (r && (r.directors.length || r.independence)) {
          filings.board = { directors: r.directors, independence: r.independence };
          filings.proxyUrl = proxy.url;
          sources.push({ url: proxy.url, title: `${filings.name} proxy statement (${proxy.date})`, retrievedAt: new Date().toISOString(), usedFor: ["sec-filings"] });
        }
      }
    }
    return { filings, sources };
  }
}
