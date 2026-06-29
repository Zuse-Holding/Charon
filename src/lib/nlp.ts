import nlp from "compromise";

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
    const name = raw.trim();
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
