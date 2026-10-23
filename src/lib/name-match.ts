/**
 * Strict organization-name matching for registries (launch fix 40, stop-
 * ship). A fuzzy hit on a shared word is not this company: MJW
 * Investments drew seven Treasury and Commerce list entries on the word
 * "Investments", and Crumbl drew "Crumbs From Christ" from ProPublica.
 *
 * Two names match when their distinctive words are the same set: legal
 * forms and generic business words don't count, and every distinctive
 * word of each name must be in the other (spelling variants aside).
 */

const LEGAL = new Set(["inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "pc",
  "pllc", "gmbh", "sa", "ag", "bv", "nv", "srl", "spa", "pty", "the", "of", "and", "dba"]);
// Words any number of unrelated organizations share.
const GENERIC = new Set(["investment", "investments", "holding", "holdings", "group", "international", "global", "services", "service",
  "solutions", "enterprises", "enterprise", "industries", "industry", "partners", "associates", "trading", "capital", "ventures",
  "management", "foundation", "fund", "trust", "america", "american", "usa", "us", "national", "systems", "technologies",
  "technology", "company", "companies", "organization", "inc"]);

const tokens = (name: string) => name.toLowerCase()
  .replace(/&/g, " and ")
  .replace(/['’]s\b/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .split(" ")
  .filter((t) => t && !LEGAL.has(t));

/** Words that set this name apart; the generic ones if there's nothing else. */
export function distinctiveWords(name: string): string[] {
  const all = tokens(name);
  const own = all.filter((t) => !GENERIC.has(t));
  return own.length ? own : all;
}

// "Crumbl" and "Crumbs" are different names; "Investments" and
// "Investment" aren't.
const same = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a === `${b}s` || b === `${a}s`));

export function strongNameMatch(candidate: string, subject: string): boolean {
  const a = distinctiveWords(candidate);
  const b = distinctiveWords(subject);
  if (!a.length || !b.length) return false;
  return a.every((x) => b.some((y) => same(x, y))) && b.every((y) => a.some((x) => same(x, y)));
}
