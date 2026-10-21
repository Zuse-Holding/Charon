import type { PersonResearchBundle, ResearchBundle } from "../types/research.js";
import { cityOf } from "./closure.js";
import { normalizeWords } from "./news-noise.js";
import { tiedToSubject, type SubjectRecord } from "./entities/subject.js";

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

const LATE_ROUND = /\bseries\s+[d-z]\b/i;
// A local or unlisted business, or one with no website: a nine-figure
// round or a late-stage series is out of scale and almost always a
// namesake's (Alan Health's $8.9B, Promise ABA's funding).
const SMALL_COMPANY_CEILING = 100e6;

export function isSmallCompany(bundle: Pick<ResearchBundle, "company">): boolean {
  const c = bundle.company;
  return !!(c.thin || c.anchor?.location || c.anchor?.unlisted);
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
  ].join(" ");
  return parseMoney(text);
}

/**
 * Analysis cites facts (Fix 3): a risk or opportunity whose dollar figure
 * isn't in the funding, spending or news facts is dropped — that's how a
 * namesake's $8.9B valuation reached Alan Health's opportunities.
 */
export function plausibleAnalysis(items: string[], bundle: ResearchBundle): string[] {
  const facts = factFigures(bundle);
  const small = isSmallCompany(bundle);
  return items.filter((item) => {
    const figures = parseMoney(item);
    if (small && (LATE_ROUND.test(item) || figures.some((v) => v >= SMALL_COMPANY_CEILING))) return false;
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
