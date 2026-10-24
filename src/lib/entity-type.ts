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

export function entityTypeOf(input: {
  company: Pick<CompanyProfile, "website" | "description" | "industry" | "role" | "chain" | "stockListing">;
  sec?: SecFilings;
  nonprofit?: NonprofitFinancials;
  franchisor?: boolean;
  funding: FundingEntry[];
}): EntityType {
  if (input.sec?.financials.length || input.sec?.tenKUrl) return "public";
  // Its site gives a stock listing ("NASDAQ: LMB"): public even while SEC
  // search is off (round 12: Limbach read as a "Subsidiary of 1347 Capital").
  if (input.company.stockListing) return "public";
  if (input.nonprofit) return "nonprofit";
  const text = [input.company.description, input.company.industry, input.company.role].filter(Boolean).join(" ");
  // A .org whose own pages say it's a nonprofit, or ask for donations.
  if (/\.org(\/|$)/i.test(input.company.website ?? "") && NONPROFIT_TEXT.test(text)) return "nonprofit";
  if (/\b(non-?profit|501\s?\(c\))/i.test(text)) return "nonprofit";
  if (input.franchisor) return "franchise";
  if (input.funding.some((f) => PRICED_ROUND.test(f.round ?? ""))) return "venture";
  return "private";
}
