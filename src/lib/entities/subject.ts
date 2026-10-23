import type { CompanyAnchor } from "../../types/research.js";
import { mentionsCompany, normalizeWords } from "../news-noise.js";
import { cityOf } from "../closure.js";

/**
 * The resolved company a report is about (Fix 1): its name plus whatever
 * ties a source to it — the website's domain and the city. Every section
 * is checked against this one record, so a namesake's pages can't drift in.
 */
export interface SubjectRecord {
  name: string;
  anchor: CompanyAnchor;
  /** Bare domain of the matched website, e.g. "juiceequity.com". */
  domain?: string;
}

export function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** " Northridge" for search queries, or "". */
export function anchorSuffix(anchor: CompanyAnchor): string {
  return anchor.location ? ` ${anchor.location}` : "";
}

/**
 * A source belongs to this company: it is on the company's own domain, or
 * it names the company and, when the user gave a city, that city too.
 */
export function tiedToSubject(text: string, url: string | undefined, rec: SubjectRecord): boolean {
  const host = hostOf(url);
  if (rec.domain && host && (host === rec.domain || host.endsWith(`.${rec.domain}`))) return true;
  if (!mentionsCompany(text, rec.name)) return false;
  const city = cityOf(rec.anchor.location);
  return !city || normalizeWords(text).includes(normalizeWords(city));
}

/**
 * A news item is about this company (launch fix 43). News names a company
 * the way people say it ("Graybar", not "Graybar Electric Company"), and a
 * headline rarely gives the city: "Homeboy Industries launches $100M
 * campaign" was dropped for not saying Los Angeles. Once a website has
 * settled who the company is, its name or short name is enough; the city
 * is still required when namesakes are known or no site was matched.
 */
export function newsAboutSubject(text: string, url: string | undefined, rec: SubjectRecord, aliases: string[] = []): boolean {
  const host = hostOf(url);
  if (rec.domain && host && (host === rec.domain || host.endsWith(`.${rec.domain}`))) return true;
  if (![rec.name, ...aliases].some((n) => mentionsCompany(text, n))) return false;
  if (rec.domain && !rec.anchor.unlisted) return true;
  const city = cityOf(rec.anchor.location);
  return !city || normalizeWords(text).includes(normalizeWords(city));
}
