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

// "Engineered" and "Engineering" are one name (launch fix 67: ACCO's
// Noresco suit names "ACCO Engineering Systems"); a plural isn't ("Stripes
// Global" is not Stripe), and "Crumbs" is not "Crumbl".
const stem = (w: string) => (w.length >= 7 ? w.replace(/(ing|ed)$/, "") : w);
const same = (a: string, b: string) => a === b || (a.length >= 7 && b.length >= 7 && stem(a) === stem(b));

export function strongNameMatch(candidate: string, subject: string): boolean {
  const a = distinctiveWords(candidate);
  const b = distinctiveWords(subject);
  if (!a.length || !b.length) return false;
  return a.every((x) => b.some((y) => same(x, y))) && b.every((y) => a.some((x) => same(x, y)));
}

// Words a company's own operating units add to its name: "Limbach
// Facility Services", "Patagonia Works". A word outside this list makes
// another entity: "Patagonia Seafarms", "Town of Patagonia" (launch fix 57).
const DIVISION = new Set(["facility", "facilities", "services", "service", "company", "companies", "construction", "mechanical",
  "electrical", "engineering", "holdings", "holding", "group", "solutions", "systems", "industries", "technologies", "international",
  "usa", "america", "americas", "north", "south", "east", "west", "works", "operations", "management", "enterprises", "global",
  "manufacturing", "products", "brands", "retail", "stores", "franchising", "franchise", "partners", "properties", "realty"]);

/**
 * The organization itself or one of its own units: every distinctive word
 * of the subject appears, and any extra word is one units add. For
 * registries that file under subsidiaries (USAspending, court parties).
 */
export function nameOrDivision(candidate: string, subject: string): boolean {
  const b = distinctiveWords(subject);
  const own = tokens(subject);
  const all = tokens(candidate);
  if (!b.length || !b.every((y) => all.some((x) => same(x, y)))) return false;
  // Every other word is the subject's own or an operating-unit word:
  // "Patagonia Investments" is another firm, "MJW Investments LLC" isn't.
  return all.every((x) => own.some((y) => same(x, y)) || DIVISION.has(x));
}

/** The parties on one side of a caption: "Patagonia, Inc. and Patagonia Works" -> two names. */
export function captionParties(side: string): string[] {
  return side
    .replace(/\bet al\.?/gi, "")
    .split(/\s*(?:;|\band\b|&|,\s*(?=[A-Z][a-z]+\s+[A-Z]))\s*/)
    .map((p) => p.replace(/^[\s,]+|[\s,]+$/g, ""))
    .filter((p) => p.length > 1);
}

/** Whether this side of a caption names the company as a party (not a namesake). */
export function partyIs(side: string, names: string[]): boolean {
  const parties = captionParties(side);
  // "Patagonia, Inc." splits on its comma only when a name follows, so the
  // whole side is also tried as one party.
  return [side, ...parties].some((p) => names.some((n) => n && nameOrDivision(p, n)));
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * The same name typed with a slip (launch fix 60: "Pomise ABA", "Crmbl"):
 * within one edit per five letters, ignoring case, spacing and legal forms.
 */
export function typoOf(typed: string, real: string): boolean {
  const a = tokens(typed).join("");
  const b = tokens(real).join("");
  if (!a || !b || a === b) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 5));
}
