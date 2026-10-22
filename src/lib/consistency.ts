import type { PersonResearchBundle, ResearchBundle } from "../types/research.js";
import { cityOf } from "./closure.js";
import { normalizeWords } from "./news-noise.js";
import { tiedToSubject, type SubjectRecord } from "./entities/subject.js";
import { isCitable } from "./source-quality.js";

/**
 * Consistency and plausibility pass, run on a company bundle before
 * synthesis and output (Fix 1 item 9, Fix 3). Pure code: every check is
 * against the one resolved subject record, never another LLM call.
 */

/** "$8.9B", "$8.9 billion", "$500M" -> dollars. */
export function parseMoney(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d+(?:[.,]\d+)*)\s*(billion|bn|b|million|mm|m|thousand|k)?\b/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const mult = unit.startsWith("b") ? 1e9 : unit === "million" || unit === "mm" || unit === "m" ? 1e6 : unit === "thousand" || unit === "k" ? 1e3 : 1;
    out.push(n * mult);
  }
  return out;
}

const JOB_LISTING = /\b(hiring|job(s| opening| posting)?|careers?|vacan(cy|te)|empleo|trabajo|apply now|now hiring|internship)\b|indeed\.com|ziprecruiter\.com|glassdoor\.com|linkedin\.com\/jobs|monster\.com|simplyhired\.com/i;

const LATE_ROUND = /\bseries\s+[d-z]\b/i;
// A local or unlisted business, or one with no website: a nine-figure
// round or a late-stage series is out of scale and almost always a
// namesake's (Alan Health's $8.9B, Promise ABA's funding).
const SMALL_COMPANY_CEILING = 100e6;

export function isSmallCompany(bundle: Pick<ResearchBundle, "company"> & Partial<Pick<ResearchBundle, "funding" | "insiderActivity" | "ownership" | "secFilings" | "nonprofitFinancials">>): boolean {
  const c = bundle.company;
  // An SEC filer with annual reports is not a small local business, whatever
  // the user typed to find it (Graybar, by its website).
  if (bundle.secFilings?.financials.length) return false;
  // A nonprofit with 990 figures on file is measured by them (launch fix
  // 35: Homeboy's $100M campaign read as out of scale).
  if (bundle.nonprofitFinancials?.years.length) return false;
  if (c.thin || c.anchor?.location || c.anchor?.unlisted || c.anchor?.website) return true;
  // No funding, filings or ownership on record: the footprint of a small
  // private company, whatever the name suggests (round 2, Fix 3).
  return bundle.funding !== undefined && bundle.funding.length === 0
    && !bundle.insiderActivity?.length && !bundle.ownership;
}

export interface ConsistencyReport {
  /** Human-readable notes on what was dropped, for the log. */
  dropped: string[];
}

export function applyCompanyConsistency(bundle: ResearchBundle, subject: SubjectRecord): ConsistencyReport {
  const dropped: string[] = [];
  const keep = <T>(label: string, items: T[], ok: (t: T) => boolean): T[] => {
    const kept = items.filter(ok);
    if (kept.length < items.length) dropped.push(`${label}: ${items.length - kept.length}`);
    return kept;
  };
  const city = cityOf(subject.anchor.location);
  const namesCity = (t: string | undefined) => !city || normalizeWords(t ?? "").includes(normalizeWords(city));

  bundle.news = keep("news not tied to the subject", bundle.news,
    (n) => tiedToSubject(`${n.headline} ${n.summary ?? ""}`, n.url, subject));
  // A job posting names the company but isn't news about it (launch fix 8:
  // Promise ABA's one "news" hit was a data-analyst listing in Burbank).
  bundle.news = keep("job listings in news", bundle.news,
    (n) => !JOB_LISTING.test(`${n.headline} ${n.url ?? ""}`));
  // Forums and other vendors' marketing pages are never cited (launch P0).
  bundle.news = keep("news from uncitable pages", bundle.news, (n) => !n.url || isCitable(n.url, subject.domain));
  bundle.sources = keep("uncitable sources", bundle.sources, (src) => isCitable(src.url, subject.domain));

  if (bundle.nonprofitFilings) {
    bundle.nonprofitFilings = keep("nonprofit filings in another city", bundle.nonprofitFilings, (n) => namesCity(n.city));
    if (bundle.nonprofitFilings.length === 0) bundle.nonprofitFilings = undefined;
  }
  if (bundle.powerMapConnections && city) {
    bundle.powerMapConnections = keep("power-map entries not naming the city", bundle.powerMapConnections, (p) => namesCity(p.blurb));
    if (bundle.powerMapConnections.length === 0) bundle.powerMapConnections = undefined;
  }

  if (isSmallCompany(bundle)) {
    bundle.funding = keep("funding out of scale", bundle.funding, (f) =>
      !LATE_ROUND.test(f.round ?? "") && parseMoney(f.amount ?? "").every((v) => v < SMALL_COMPANY_CEILING));
  }

  // A thin report keeps only what ties to the record by identifier or
  // filing: no competitors or insider activity found by name alone.
  if (bundle.company.thin) {
    if (bundle.competitors.length) dropped.push(`competitors (thin report): ${bundle.competitors.length}`);
    bundle.competitors = [];
    bundle.insiderActivity = undefined;
    // News found by the name alone is a namesake's as often as not
    // (a Singapore "Zuse Labs" in a Zuse Holdings report).
    if (bundle.news.length) dropped.push(`news (thin report): ${bundle.news.length}`);
    bundle.news = [];
    bundle.funding = [];
    bundle.ownership = undefined;
  }
  return { dropped };
}

/** Facts the analysis may cite: every dollar figure in it must appear here. */
function factFigures(bundle: ResearchBundle): number[] {
  const text = [
    ...bundle.funding.map((f) => f.amount ?? ""),
    ...(bundle.federalSpending ?? []).map((f) => f.amount ?? ""),
    ...bundle.news.map((n) => `${n.headline} ${n.summary ?? ""}`),
    // SEC financials, as the report states them ("$12.88B").
    ...(bundle.secFilings?.financials ?? []).flatMap((y) => [y.revenue, y.netIncome].filter((v): v is number => v !== undefined).map((v) => `$${v}`)),
    bundle.secFilings?.legalProceedings ?? "",
    ...[bundle.secFilings?.latestQuarter?.revenue, bundle.secFilings?.latestQuarter?.priorRevenue].filter((v): v is number => v !== undefined).map((v) => `$${v}`),
    ...(bundle.secFilings?.earnings ? [...bundle.secFilings.earnings.highlights, bundle.secFilings.earnings.guidance ?? ""] : []),
    ...(bundle.nonprofitFinancials?.years ?? []).flatMap((y) => [y.revenue, y.expenses, y.assets, y.contributions])
      .filter((v): v is number => v !== undefined).map((v) => `$${v}`),
    ...(bundle.contractCeilings ?? []).flatMap((c) => [`$${c.ceiling}`, `$${c.obligated}`]),
    ...(bundle.fdd ? [bundle.fdd.franchisorRevenue, bundle.fdd.franchisorNetIncome, bundle.fdd.averageUnitSales, bundle.fdd.initialInvestment] : []).map((v) => v ?? ""),
  ].join(" ");
  return parseMoney(text);
}

// "fund" too (launch fix 10): MJW's Opportunities cited a $100M fund
// target while its Funding section said nothing was found.
// What a nonprofit can't have (launch fix 34): it raises money, but never
// in rounds or from investors.
const INVESTOR_TERMS = /\b(seed|series [a-z]|valuation|valued at|investors?|venture[- ]backed|vc[- ]backed|ipo)\b/i;
const FUNDING_TERMS = /\b(raised?|raising|seed|series [a-z]|funding|funded|funds?|fundraise|valuation|valued at|investors?|venture[- ]backed|vc[- ]backed|ipo)\b/i;

// Capitalized words that aren't names: sentence words, units, months.
const COMMON_CAPS = new Set([
  "a", "an", "the", "its", "it", "their", "this", "that", "these", "those", "as", "with", "without", "no", "not", "if", "in", "on", "at",
  "for", "by", "from", "to", "of", "and", "or", "but", "while", "because", "since", "after", "before", "over", "under", "more", "less",
  "u.s", "us", "usa", "llc", "inc", "ltd", "co", "corp", "ceo", "cfo", "coo", "cto", "founder", "owner", "president",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
]);

/** Capitalized words and acronyms past the first word: the names an item brings in. */
function namesIn(item: string): string[] {
  const words = item.match(/[A-Za-z][A-Za-z0-9&.'’-]*/g) ?? [];
  return words.slice(1)
    .map((w) => w.replace(/['’]s$/, "").replace(/[.'’-]+$/, ""))
    .filter((w) => /^[A-Z]/.test(w) && !COMMON_CAPS.has(w.toLowerCase()));
}

// Words an analyst sentence uses whatever the business: they ground nothing.
const ANALYSIS_WORDS = new Set([
  "company", "companys", "could", "would", "should", "might", "their", "there", "which", "while",
  "about", "other", "more", "most", "less", "than", "into", "from", "with", "without", "this", "that", "these", "those",
  "risk", "risks", "opportunity", "opportunities", "growth", "market", "markets", "customers", "revenue", "brand",
  "offering", "offers", "keeps", "makes", "gives", "help", "helps", "limits", "limited", "expand", "expands", "attract",
  "increase", "reduce", "position", "strong", "public",
]);

/** The item shares a substantive word (not the company's own name) with
 *  the facts: it's about something the report states. */
function grounded(item: string, factWords: Set<string>, companyWords: Set<string>): boolean {
  const stem = (w: string) => w.slice(0, 5);
  return normalizeWords(item).trim().split(" ")
    .filter((w) => w.length >= 4 && !ANALYSIS_WORDS.has(w) && !companyWords.has(w))
    .some((w) => factWords.has(stem(w)));
}

/**
 * Analysis cites facts (Fix 3): a risk or opportunity whose dollar figure
 * isn't in the funding, spending or news facts is dropped — that's how a
 * namesake's $8.9B valuation reached Alan Health's opportunities.
 *
 * With the locked fact set (round 2, Fix 3), an item is also dropped when
 * it names something no fact mentions (Juice Equity's "Bitcoin treasury"),
 * or talks about funding when the report found none (its "$40M seed"):
 * the report never contradicts its own Funding section.
 */
export function plausibleAnalysis(items: string[], bundle: ResearchBundle, lockedFacts?: { text: string }[]): string[] {
  const facts = factFigures(bundle);
  const small = isSmallCompany(bundle);
  const factText = lockedFacts ? normalizeWords([bundle.company.name, ...lockedFacts.map((f) => f.text)].join(" ")) : undefined;
  const companyWords = new Set(normalizeWords(bundle.company.name).trim().split(" "));
  // Fact words by stem, minus the labels lockedFacts puts in front ("Offers:").
  const factWords = new Set((lockedFacts ?? [])
    .flatMap((f) => normalizeWords(f.text.replace(/^[^:]{1,30}:/, "")).trim().split(" "))
    .filter((w) => w.length >= 4 && !companyWords.has(w))
    .map((w) => w.slice(0, 5)));
  return items.filter((item) => {
    const figures = parseMoney(item);
    if (small && (LATE_ROUND.test(item) || figures.some((v) => v >= SMALL_COMPANY_CEILING))) return false;
    // Funding words need funding on record, except where the money is on
    // record elsewhere: a public company's filings, a nonprofit's 990.
    const type = bundle.company.entityType;
    if (type === "nonprofit" ? INVESTOR_TERMS.test(item) : type !== "public" && bundle.funding.length === 0 && FUNDING_TERMS.test(item)) return false;
    if (factText && namesIn(item).some((n) => !factText.includes(normalizeWords(n)))) return false;
    if (lockedFacts && !grounded(item, factWords, companyWords)) return false;
    return figures.every((v) => facts.some((f) => Math.abs(f - v) <= v * 0.01));
  });
}

/** Person bundles: news and filings must name the person (and affiliation). */
export function applyPersonConsistency(bundle: PersonResearchBundle): void {
  const aff = bundle.person.affiliation?.toLowerCase();
  if (aff && bundle.powerMapConnections) {
    bundle.powerMapConnections = bundle.powerMapConnections.filter((p) => (p.blurb ?? "").toLowerCase().includes(aff));
    if (bundle.powerMapConnections.length === 0) bundle.powerMapConnections = undefined;
  }
}
