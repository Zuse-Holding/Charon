/**
 * Entity type auto-detection
 * Best-effort heuristic to classify a search query as company, person,
 * or product before the user has to select a type manually.
 *
 * Not perfect — "Apple" could be company or product, "Amazon" is both
 * a company and a product name. But it catches the obvious cases like
 * "Elon Musk" being a person and "PlayStation 5" being a product.
 */

// Common person name indicators
const PERSON_PREFIXES = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sir", "dame",
  "ceo", "cto", "coo", "cfo", "founder", "co-founder",
]);

// Product indicators — version numbers, model names, etc.
const PRODUCT_PATTERNS = [
  /\d+(\.\d+)?/, // version numbers like "iPhone 15" or "Model 3"
  /^(iphone|ipad|macbook|airpods|galaxy|pixel|surface|xbox|playstation|ps\d|nintendo)/i,
  /\b(pro|max|ultra|plus|mini|lite|se|xl|gen\s?\d)\b/i,
];

// Known company suffixes
const COMPANY_SUFFIXES = [
  "inc", "llc", "ltd", "corp", "co", "company", "group",
  "holdings", "enterprises", "ventures", "capital", "partners",
  "technologies", "tech", "systems", "solutions", "services",
  "health", "labs", "ai", "io",
];

// Common first names (heuristic — not exhaustive)
const COMMON_FIRST_NAMES = new Set([
  "james", "john", "robert", "michael", "william", "david", "richard",
  "joseph", "thomas", "charles", "mary", "patricia", "jennifer", "linda",
  "barbara", "elizabeth", "susan", "jessica", "sarah", "karen", "lisa",
  "elon", "jeff", "mark", "larry", "sergey", "bill", "steve", "tim",
  "satya", "sundar", "sam", "jensen", "reed", "travis", "brian",
  "patrick", "jack", "peter", "paul", "andrew", "alex", "ryan",
  "kevin", "chris", "daniel", "matthew", "anthony", "donald", "emily",
  "ashley", "amanda", "stephanie", "melissa", "rachel", "angela",
]);

export type ResearchType = "company" | "person" | "product";

export function detectEntityType(query: string): ResearchType {
  const q = query.trim();
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/);

  // Check known easter egg names first
  const easterEggPeople = ["bruce wayne", "tony stark", "lex luthor", "patrick bateman"];
  const easterEggCompanies = ["wayne enterprises", "stark industries", "lexcorp", "cyberdyne systems", "lex corp"];
  if (easterEggPeople.some(n => lower === n)) return "person";
  if (easterEggCompanies.some(n => lower === n)) return "company";

  // Person prefix check
  if (PERSON_PREFIXES.has(words[0])) return "person";

  // Company suffix check
  const lastWord = words[words.length - 1].replace(/[.,]/g, "");
  if (COMPANY_SUFFIXES.includes(lastWord)) return "company";

  // Product pattern check
  if (PRODUCT_PATTERNS.some(p => p.test(q))) return "product";

  // Two-word check: "First Last" pattern
  if (words.length === 2 && COMMON_FIRST_NAMES.has(words[0])) {
    // Second word looks like a surname (no special chars, not a known suffix)
    const secondWord = words[1].replace(/[.,]/g, "");
    if (!COMPANY_SUFFIXES.includes(secondWord) && /^[a-z]+$/.test(secondWord)) {
      return "person";
    }
  }

  // Three-word check with known first name
  if (words.length === 3 && COMMON_FIRST_NAMES.has(words[0])) {
    return "person";
  }

  // Default to company — most searches are company lookups
  return "company";
}
