import nlp from "compromise";
import { findWebsite, hostLabel } from "./entities/site-record.js";

/**
 * Local, offline named-entity helpers built on `compromise` (a
 * lightweight, rule-based NLP library — no API key, no network call, no
 * cost). This is meaningfully better than raw capitalized-word regex
 * because compromise understands sentence structure: it tags actual
 * organizations rather than any capitalized phrase, so sentence
 * fragments like "Although Stripe" or "It" don't get treated as company
 * names.
 *
 * This is still not an LLM — it can miss unusual names and occasionally
 * mistag things — but it's a real step up from pure regex, for zero
 * marginal cost. LLM-based extraction remains the eventual upgrade path
 * if this isn't accurate enough once tested against more companies.
 */

/** Extracts organization-tagged names from text, deduped, with the
 * queried company itself filtered out. */
export function extractOrganizations(
  text: string,
  excludeName: string
): string[] {
  const doc = nlp(text);
  const orgs = doc.organizations().out("array") as string[];

  const excludeLower = excludeName.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of orgs) {
    // Strip leading/trailing punctuation left over from sentence
    // boundaries ("Quantum Systems," / "Anduril Industries _") — plain
    // .trim() only removes whitespace, so two extractions of the same
    // org that differ only by trailing punctuation were previously
    // treated as different entities instead of being merged.
    const name = raw.trim().replace(/^[-–—_,:;.\s]+|[-–—_,:;.\s]+$/g, "");
    if (name.length < 2) continue;

    const lower = name.toLowerCase();
    if (lower === excludeLower) continue;
    if (excludeLower.includes(lower) || lower.includes(excludeLower)) continue;

    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(name);
  }

  return out;
}

/** Splits text into sentences using compromise's sentence boundaries —
 * more reliable than a naive split on periods (handles "Inc.", "$5.2M",
 * abbreviations, etc. without breaking mid-sentence). */
export function splitSentences(text: string): string[] {
  return nlp(text).sentences().out("array") as string[];
}

export interface ParsedPersonQuery {
  /** Clean person name only — what should be stored/displayed/deduped. */
  name: string;
  /** School, employer, or org typed alongside the name to disambiguate a
   *  common name (e.g. "csun", "at Google"). Undefined when none detected. */
  affiliation?: string;
}

// Explicit separators a user might type between name and affiliation —
// checked first since they're unambiguous wherever they appear.
// " · " is what the person candidate picker sends ("Doug Shapses · UCLA Health").
const AFFILIATION_SEPARATORS = [" · ", " at ", " from ", " with ", " in ", " @ ", " - ", " — "];

/**
 * Splits a person-search query like "Daniel Olmos csun" or
 * "Jane Smith at Google" into a clean person name plus an optional
 * affiliation/context string (school, employer, org). Used across every
 * person-research entry point (agent-server /research route, CLI) so the
 * *name* stays clean for display, report titles, DB storage, and KG
 * dedup — while the affiliation still gets threaded into search queries
 * and the extraction prompt to help disambiguate common names.
 *
 * Detection, in priority order:
 *   1. Explicit separator ("Jane Smith at Google", "Jane Smith - Acme").
 *   2. Comma form ("Daniel Olmos, CSUN").
 *   3. Implicit trailing-lowercase-word heuristic: ONLY when the presumed
 *      name portion (first two words) is Title-Cased, a trailing run of
 *      lowercase-initial word(s) is treated as affiliation shorthand
 *      ("Daniel Olmos csun" -> name "Daniel Olmos", affiliation "csun").
 *      Gated on the name being capitalized so an all-lowercase query
 *      (common when users don't bother with caps at all) isn't
 *      mis-split — ambiguous input is left alone rather than guessed.
 *   4. Trailing US state: "John Smith Austin TX" -> location "Austin TX".
 *   5. Capitalized affiliation: from the third word on, an acronym or a
 *      known organization word starts the affiliation
 *      ("Michael Jordan UC Berkeley", "Jane Smith Stanford University").
 * Falls back to treating the whole string as the name when nothing
 * matches — same "don't guess" policy as the rest of this file.
 */
export function parsePersonQuery(raw: string): ParsedPersonQuery {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { name: trimmed };

  for (const sep of AFFILIATION_SEPARATORS) {
    const idx = trimmed.toLowerCase().indexOf(sep);
    if (idx > 0) {
      const name = trimmed.slice(0, idx).trim();
      const affiliation = trimmed.slice(idx + sep.length).trim();
      if (name && affiliation) return { name, affiliation };
    }
  }

  if (trimmed.includes(",")) {
    const [namePart, ...rest] = trimmed.split(",");
    const affiliation = rest.join(",").trim();
    // "John Smith Austin, TX": the comma splits city from state, not name
    // from context — let the location rule below place the city.
    const affWords = affiliation.split(" ");
    const commaSplitsCityFromState = trailingStateLength(affWords) === affWords.length && namePart.trim().split(" ").length >= 3;
    if (namePart.trim() && affiliation && !commaSplitsCityFromState) return { name: namePart.trim(), affiliation };
  }

  const words = trimmed.replace(/,/g, "").split(" ");
  const nameLooksCapitalized = words.length >= 2 && /^[A-Z]/.test(words[0]) && /^[A-Z]/.test(words[1]);
  if (words.length >= 3 && nameLooksCapitalized) {
    let i = words.length - 1;
    while (i >= 2 && /^[a-z]/.test(words[i])) i--;
    const splitIdx = i + 1;
    if (splitIdx >= 2 && splitIdx < words.length) {
      return { name: words.slice(0, splitIdx).join(" "), affiliation: words.slice(splitIdx).join(" ") };
    }

    // 4. Trailing US state ("John Smith Austin TX", "Maria Garcia San Diego
    //    California"): the state plus the city word(s) before it are the
    //    location; whatever precedes is the name.
    const location = splitTrailingLocation(words);
    if (location) return location;

    // 5. Capitalized affiliation ("Michael Jordan UC Berkeley"): split at the
    //    first word from the third on that clearly names an organization.
    //    Anything else stays part of the name ("Mary Ann Smith").
    const orgIdx = words.findIndex((w, idx) => idx >= 2 && isOrgSignal(w));
    if (orgIdx !== -1) {
      // "Labs", "Inc", "University"... follow the org's own name ("Acme Labs"),
      // so the affiliation starts one word earlier when that leaves a full name.
      const start = ORG_SUFFIX_WORDS.has(words[orgIdx].toLowerCase()) && orgIdx >= 3 ? orgIdx - 1 : orgIdx;
      return { name: words.slice(0, start).join(" "), affiliation: words.slice(start).join(" ") };
    }
  }

  return { name: trimmed };
}

// Generational suffixes look like acronyms but belong to the name.
const NAME_SUFFIXES = new Set(["II", "III", "IV", "VI", "JR", "SR", "MD", "PHD"]);
// Words that end an organization's name ("Acme Labs", "Stanford University").
const ORG_SUFFIX_WORDS = new Set([
  "university", "college", "school", "institute", "academy", "hospital", "clinic",
  "inc", "inc.", "corp", "corp.", "corporation", "llc", "ltd", "co", "co.", "company",
  "labs", "lab", "group", "capital", "ventures", "partners", "bank", "foundation", "agency",
]);
const ORG_WORDS = new Set([
  ...ORG_SUFFIX_WORDS,
  // Schools and employers people commonly type as bare names.
  "berkeley", "stanford", "harvard", "yale", "princeton", "columbia", "cornell", "ucla", "nyu",
  "google", "microsoft", "apple", "amazon", "meta", "facebook", "netflix", "tesla", "nvidia",
  "openai", "anthropic", "stripe", "salesforce", "oracle", "intel", "uber", "airbnb",
]);

/** A word that marks the start of an organization: an acronym (UC, MIT, CSUN) or a known org word. */
function isOrgSignal(word: string): boolean {
  const bare = word.replace(/[,.]$/, "");
  if (/^[A-Z]{2,}$/.test(bare) && !NAME_SUFFIXES.has(bare) && !US_STATE_CODES.has(bare)) return true;
  return ORG_WORDS.has(word.toLowerCase());
}

// Title words reused from extractRoleAndCompany, kept as a flat list so
// it can anchor a "Name, Title" / "Name is the Title" pattern too.
const TITLE_WORDS_RE =
  /(chief executive officer|chief technology officer|chief financial officer|chief operating officer|chief product officer|co-founder and ceo|co-founder|cofounder|founder|president|chairman|chairwoman|managing director|executive director|general counsel|vice president|CEO|CTO|CFO|COO|CMO)/i;

/**
 * Extracts (person name, title) pairs from text using compromise's
 * person-name tagging plus nearby title-word matching. Looks for two
 * common patterns per sentence:
 *   "Jane Doe, CEO of Acme" / "Jane Doe, the company's CTO"
 *   "Jane Doe is the President of Acme"
 * Best-effort — misses unusual phrasing, same tradeoff as every other
 * heuristic extractor in this codebase. Returns [] rather than guessing
 * when no clear pairing is found in a sentence.
 */
export function extractPeopleWithTitles(
  text: string
): { name: string; title: string }[] {
  const sentences = splitSentences(text);
  const out: { name: string; title: string }[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    const doc = nlp(sentence);
    const people = doc.people().out("array") as string[];
    if (people.length === 0) continue;

    for (const raw of people) {
      // compromise sometimes includes trailing punctuation from the
      // sentence (e.g. a comma right after the name) in its output.
      const name = raw.replace(/[,.;:]+$/, "").trim();
      const key = name.toLowerCase();
      if (seen.has(key)) continue;

      // Pair with the nearest title word found AFTER this person's name
      // in the sentence, not just "the first title anywhere in the
      // sentence" — that previously caused every person in a multi-name
      // sentence to incorrectly get the same (first) title.
      const nameIdx = sentence.indexOf(raw);
      if (nameIdx === -1) continue;
      const after = sentence.slice(nameIdx + raw.length);
      const titleMatch = after.match(TITLE_WORDS_RE);
      if (!titleMatch) continue;

      seen.add(key);
      out.push({ name, title: titleMatch[1].trim() });
    }
  }

  return out;
}

// Generic words that show up in "our products" copy but aren't product
// names themselves — filtered out of candidate extraction below.
export const PRODUCT_STOPWORDS = new Set([
  "Products",
  "Solutions",
  "Services",
  "Pricing",
  "Resources",
  "Developers",
  "Sign",
  "Contact",
  "Home",
  "About",
  "Learn",
  "More",
  "Get",
  "Started",
]);

/**
 * Extracts capitalized multi-word (or single distinctive-word) phrases
 * as product-name candidates. Unlike extractOrganizations, this does
 * NOT use compromise's org tagging — product names ("Checkout",
 * "Treasury", "Adaptive Pricing") usually aren't recognized as
 * organizations, so this falls back to capitalized-phrase regex with a
 * stoplist, same approach as the original competitor heuristic.
 * Noisier than extractOrganizations by design tradeoff — flagged as
 * best-effort in the report.
 */
export function extractProductCandidates(text: string): string[] {
  const matches =
    text.match(/\b([A-Z][a-zA-Z0-9]*(?:\s[A-Z][a-zA-Z0-9]*){0,2})\b/g) ?? [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const candidate = raw.trim();
    if (candidate.length < 3) continue;

    const words = candidate.split(/\s+/);
    if (words.every((w) => PRODUCT_STOPWORDS.has(w))) continue;
    if (words.length === 1 && PRODUCT_STOPWORDS.has(words[0])) continue;

    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }

  return out;
}
// Matches phrasing like "is the CEO of Acme", "serves as President at
// Acme Corp", "currently CTO of Acme" — title written in Capital Case.
const ROLE_AT_COMPANY_RE =
  /\b(?:is|serves as|currently|works as)\s+(?:the\s+)?([A-Z][\w&.\s]{1,40}?)\s+(?:of|at)\s+([A-Z][\w&.,\s]{1,50}?)(?:[.,]|\s+(?:and|where|since)\b|$)/;

// Common titles as they actually appear mid-sentence in lowercase prose
// ("is the chief executive officer of Stripe"). The earlier regex only
// matched Capitalized titles like "CEO", missing this far more common
// phrasing.
const LOWERCASE_TITLES = [
  "chief executive officer",
  "chief technology officer",
  "chief financial officer",
  "chief operating officer",
  "chief product officer",
  "co-founder and chief executive",
  "co-founder",
  "cofounder",
  "founder",
  "president",
  "chairman",
  "chairwoman",
  "managing director",
  "executive director",
  "general counsel",
  "vice president",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "cmo",
];

const COMPANY_AFTER_RE =
  /^\s+(?:of|at)\s+([A-Z][\w&.,\s]{1,50}?)(?:[.,]|\s+(?:and|where|since|which)\b|$)/;

// Matches the reverse ordering common in job-title-style listings, e.g.
// "Patrick Collison - Stripe CEO" or "Jane Doe, Acme Corp President".
const REVERSED_RE =
  /\b([A-Z][\w&.\s]{1,40}?)\s+(CEO|CTO|CFO|COO|CMO|President|Chairman|Founder|Co-Founder)\b/;

/** Best-effort extraction of a person's current role + company from a
 * sentence. Tries, in order: "is the CEO of Acme" (Capitalized title),
 * "is the chief executive officer of Acme" (lowercase title phrase),
 * then "Acme CEO" (reversed ordering, common in bios/listings). Returns
 * null if nothing matches — left undefined in the report rather than
 * guessed, same policy as every other agent. */
export function extractRoleAndCompany(
  sentence: string
): { role: string; company: string } | null {
  const capMatch = sentence.match(ROLE_AT_COMPANY_RE);
  if (capMatch) {
    return { role: capMatch[1].trim(), company: capMatch[2].trim() };
  }

  const lower = sentence.toLowerCase();
  for (const title of LOWERCASE_TITLES) {
    const idx = lower.indexOf(title);
    if (idx === -1) continue;

    const after = sentence.slice(idx + title.length);
    const companyMatch = after.match(COMPANY_AFTER_RE);
    if (!companyMatch) continue;

    const role = sentence.slice(idx, idx + title.length).trim();
    return { role, company: companyMatch[1].trim() };
  }

  const reversedMatch = sentence.match(REVERSED_RE);
  if (reversedMatch) {
    return { role: reversedMatch[2].trim(), company: reversedMatch[1].trim() };
  }

  return null;
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);
const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
].map((n) => n.toLowerCase().split(" "));
const SURNAME_STATES = new Set(["washington", "georgia", "virginia", "montana", "nevada", "indiana"]);
// First words of two-word city names ("San Diego", "Las Vegas", "St. Louis").
const CITY_PREFIXES = new Set([
  "san", "santa", "los", "las", "new", "saint", "st.", "st", "fort", "ft.", "el", "salt",
  "palm", "long", "grand", "lake", "port", "mount", "mt.", "north", "south", "east", "west", "del", "la",
]);

/** How many trailing words form a US state (code or full name), 0 if none. */
function trailingStateLength(words: string[]): number {
  const last = words[words.length - 1].replace(/[,.]$/, "");
  if (US_STATE_CODES.has(last)) return 1;
  const lower = words.map((w) => w.replace(/[,.]$/, "").toLowerCase());
  for (const state of US_STATE_NAMES) {
    if (state.length <= lower.length && state.every((w, i) => lower[lower.length - state.length + i] === w)) return state.length;
  }
  return 0;
}

/**
 * "John Smith Austin TX" -> { name: "John Smith", affiliation: "Austin TX" }.
 * The city is one word, or two after a common prefix ("San Diego"); the
 * name keeps at least two words, so "Mary Ann Smith Austin TX" stays intact.
 */
function splitTrailingLocation(words: string[]): ParsedPersonQuery | null {
  const stateLen = trailingStateLength(words);
  if (stateLen === 0) return null;
  // "Sarah Jane Washington", "Booker T. Washington": a state that's also a
  // common surname only counts when a city or state code makes it clear.
  const stateWord = words[words.length - 1].toLowerCase();
  if (SURNAME_STATES.has(stateWord) && words.length < 4) return null;
  let start = words.length - stateLen;
  if (start >= 3) {
    start -= 1; // one-word city
    if (start >= 3 && CITY_PREFIXES.has(words[start - 1].toLowerCase())) start -= 1;
  }
  if (start < 2) return null;
  return { name: words.slice(0, start).join(" "), affiliation: words.slice(start).join(" ").replace(/,/g, "") };
}

// Connecting words that are never a product on their own ("for", "and").
const PRODUCT_FILLER = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "at", "by", "with", "our", "your", "all", "or", "&",
]);

const words = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9&]+/).filter(Boolean);

// Page furniture and headline words: an item carrying one is a page title
// or a news fragment ("Crunchbase Company Profile", "MJW Investments
// Acquires"), not something the company sells (round 2, Fix 5).
const NOT_AN_OFFERING = /\b(crunchbase|linkedin|wikipedia|bloomberg|profile|overview|home ?page|homepage|about us|contact us|reviews?|press release|news|blog|acquires?|acquired|acquisition|announces?|raises?|funding|valuation|ipo|hiring|careers?|jobs?|log ?in|sign ?up|privacy|terms|cookies?|copyright|all rights reserved|click here|read more|learn more|information|details|locations?|directions|hours|address)\b/i;
const DATE_WORD = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?|(19|20)\d{2})\b/i;
// A one-word offering reads as a field of work ("Orthodontics",
// "Bookkeeping"); other single words are fragments ("Off", "Market").
const ONE_WORD_OFFERING = /^[a-z]{4,}(ics|ing|tion|sion|ment|ance|ence|ery|ogy|ism|ure|ship)$/i;

/**
 * Products cleanup pass (Fix 2, round 2 Fix 5): keeps only offerings — a
 * noun phrase naming something the company sells or does. Drops fragments
 * ("for"), single words that aren't a field of work ("Off", "Market"),
 * page titles and site names, months and dates, headline fragments,
 * repeated words, anything naming the company itself, duplicates, and,
 * when `sourceText` is given, anything whose words don't all appear in the
 * text it was extracted from.
 */
export function cleanProducts<T extends { name: string }>(products: T[], companyName: string, sourceText?: string): T[] {
  const companyWords = new Set(words(companyName));
  const companyPhrase = words(companyName).join(" ");
  const generic = new Set([...PRODUCT_FILLER, ...[...PRODUCT_STOPWORDS].map((w) => w.toLowerCase())]);
  const source = sourceText ? new Set(words(sourceText)) : undefined;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of products) {
    const name = p.name.replace(/\*\*/g, "").replace(/\s+/g, " ").replace(/^[\s\-–—•,.;:]+|[\s\-–—•,.;:]+$/g, "");
    const w = words(name);
    if (name.length < 3 || w.length === 0 || name.length > 80) continue;
    if (w.length === 1 && !ONE_WORD_OFFERING.test(w[0])) continue;
    if (/[|]/.test(name) || NOT_AN_OFFERING.test(name) || DATE_WORD.test(name)) continue;
    if (companyPhrase && ` ${w.join(" ")} `.includes(` ${companyPhrase} `)) continue;
    if (w.some((x, i) => i > 0 && x === w[i - 1])) continue;
    if (w.every((x) => generic.has(x) || companyWords.has(x))) continue;
    if (source && !w.every((x) => generic.has(x) || source.has(x))) continue;
    const key = w.join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, name });
  }
  return out;
}

/**
 * A leadership entry names a person (round 2, Fix 5): a first and last
 * name, letters only, and not just words from the company's own name
 * ("Alan" for Alan Health).
 */
export function isPersonName(name: string, companyName: string): boolean {
  const parts = name.replace(/\b(Dr|Mr|Mrs|Ms|Prof)\.?\s+/gi, "").replace(/,.*$/, "").trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 5) return false;
  if (!parts.every((p) => /^[A-Z][A-Za-z'’\-.]*$/.test(p))) return false;
  const company = new Set(words(companyName));
  return !parts.every((p) => company.has(p.toLowerCase().replace(/['’.]/g, "")));
}

/** Anchor text the candidate picker sends for "None of these" (Fix 1). */
export const UNLISTED_ANCHOR = "not listed online";

export interface ParsedCompanyQuery {
  /** The business name alone. */
  name: string;
  /** The city/state or website typed after " · " (Fix 1), or a website
   *  typed anywhere (round 2, Fix 1). */
  anchor: { location?: string; website?: string; unlisted?: boolean; nameFromSite?: boolean };
}

/**
 * Splits a company search like "Smile Design Studio · Northridge" or
 * "Juice Equity · juiceequity.com" into the name and its anchor. The web
 * search bar joins its two fields this way, so the stored run subject
 * keeps the anchor and a rerun searches the same business.
 *
 * A website anywhere in the input drives the match (round 2, Fix 1):
 * "sdsdentistry.com" alone is a search for whatever business that site is,
 * named from the site itself once it's read.
 */
export function parseCompanyQuery(raw: string): ParsedCompanyQuery {
  const [namePart, ...rest] = raw.split("·").map((p) => p.trim());
  const value = rest.join(" ").replace(/\s+/g, " ").trim().slice(0, 100);
  // The candidate picker's "None of these": a thin report, no namesakes.
  if (value.toLowerCase() === UNLISTED_ANCHOR) return { name: namePart, anchor: { unlisted: true } };

  const inName = findWebsite(namePart);
  const inAnchor = value ? findWebsite(value) : undefined;
  const site = inAnchor ?? inName;
  const name = (inName ? inName.rest : namePart).trim();
  const location = (inAnchor ? inAnchor.rest : value).trim() || undefined;
  if (!site) return { name: namePart || raw.trim(), anchor: location ? { location } : {} };
  return {
    name: name || hostLabel(site.website),
    anchor: { website: site.website, ...(location ? { location } : {}), ...(name ? {} : { nameFromSite: true }) },
  };
}

/** Reads as a person's name ("Doug Shapses", "Doug Shapses UCLA"): used to
 *  offer a person search when a company search finds no business. */
export function looksLikePersonName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((w) => ORG_SUFFIX_WORDS.has(w.toLowerCase()))) return false;
  return (nlp(text).people().out("array") as string[]).length > 0;
}

/** An affiliation that is only a place ("Austin TX", "Santa Paula, CA"):
 *  not enough to tell two same-named people apart (Fix 5). */
export function isLocationOnly(affiliation: string): boolean {
  const words = affiliation.replace(/,/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && trailingStateLength(words) > 0 && words.length <= 4;
}
