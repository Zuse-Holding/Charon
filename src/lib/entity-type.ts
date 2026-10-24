import type { CompanyProfile, EntityType, FundingEntry, NonprofitFinancials } from "../types/research.js";
import type { SecFilings } from "../agents/sec-filings-agent/index.js";

/**
 * What kind of organization a report is about (launch fix 34), decided
 * before Funding is filled: a nonprofit's money is contributions and
 * grants, a public company's is in its filings, and only a venture-backed
 * company has rounds. Homeboy Industries, a 501(c)(3), showed "Series B:
 * $76M", another organization's round.
 */

const NONPROFIT_TEXT = /\b(non-?profit|not-for-profit|501\s?\(c\)\s?\(?3\)?|charit(y|able organization)|tax-deductible|donate|donations?)\b/i;
const PRICED_ROUND = /\b(pre-?seed|seed|series [a-h]|venture)\b/i;

const DAY = 86_400_000;
const MAX_PARENT_AGE = 2 * 365 * DAY;

/** When a source was published: its reported date ("Aug 19, 2026", "3 days ago"), else a year in its address ("/2016/07/"). */
export function sourceTime(src: { url: string; date?: string }, now = Date.now()): number | undefined {
  const rel = src.date?.match(/^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/i);
  if (rel) return now - Number(rel[1]) * { hour: DAY / 24, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY }[rel[2].toLowerCase() as "day"];
  const t = src.date ? Date.parse(src.date) : NaN;
  if (!isNaN(t)) return t;
  const year = src.url.match(/\/((?:19|20)\d{2})\//)?.[1];
  return year ? Date.parse(`${year}-07-01`) : undefined;
}

/**
 * A parent named only by old sources is history, not ownership (round 15:
 * Limbach read "Wholly-owned subsidiary of 1347 Capital", the shell it
 * merged with in 2016). Stale when every dated source naming the parent is
 * over about two years old; undated sources don't count either way.
 */
export function staleParent(note: string, sources: { url: string; text: string; date?: string }[], now = Date.now()): boolean {
  const owner = note.match(/\b(?:of|by)\s+(.+)$/i)?.[1].replace(/[.,;]+$/, "").trim().toLowerCase();
  if (!owner || owner.length < 3) return false;
  const times = sources.filter((s) => s.text.toLowerCase().includes(owner))
    .map((s) => sourceTime(s, now)).filter((t): t is number => t !== undefined);
  return times.length > 0 && Math.max(...times) < now - MAX_PARENT_AGE;
}

export function entityTypeOf(input: {
  company: Pick<CompanyProfile, "website" | "description" | "industry" | "role" | "chain" | "stockListing">;
  sec?: SecFilings;
  nonprofit?: NonprofitFinancials;
  franchisor?: boolean;
  funding: FundingEntry[];
}): EntityType {
  if (input.sec?.financials.length || input.sec?.tenKUrl) return "public";
  if (input.nonprofit) return "nonprofit";
  // Its site gives a stock listing ("NASDAQ: LMB"): public even while SEC
  // search is off (round 12: Limbach read as a "Subsidiary of 1347 Capital").
  if (input.company.stockListing) return "public";
  const text = [input.company.description, input.company.industry, input.company.role].filter(Boolean).join(" ");
  // A .org whose own pages say it's a nonprofit, or ask for donations.
  if (/\.org(\/|$)/i.test(input.company.website ?? "") && NONPROFIT_TEXT.test(text)) return "nonprofit";
  if (/\b(non-?profit|501\s?\(c\))/i.test(text)) return "nonprofit";
  if (input.franchisor) return "franchise";
  if (input.funding.some((f) => PRICED_ROUND.test(f.round ?? ""))) return "venture";
  return "private";
}
