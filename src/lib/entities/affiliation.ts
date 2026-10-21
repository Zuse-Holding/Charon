import { normalizeWords } from "../news-noise.js";

/**
 * Employer variants count as one (round 2, Fix 2): "UCLA Health", "UCLA"
 * and "University of California, Los Angeles" all name the same anchor.
 */

// Words that start many organization names and identify none of them.
const GENERIC_ORG_WORDS = new Set(["the", "city", "county", "state", "university", "college", "school", "of", "inc", "group", "company", "department", "health", "medical", "center"]);
// Skipped when reading an acronym off a name ("University of California").
const CONNECTORS = new Set(["of", "the", "at", "and", "for", "in"]);

/** The text has a run of words whose initials spell `acronym` ("ucla"). */
function spellsAcronym(words: string[], acronym: string): boolean {
  const content = words.filter((w) => !CONNECTORS.has(w));
  for (let i = 0; i + acronym.length <= content.length; i++) {
    if ([...acronym].every((ch, j) => content[i + j][0] === ch)) return true;
  }
  return false;
}

export function mentionsAffiliation(text: string, affiliation: string): boolean {
  const t = normalizeWords(text);
  const a = normalizeWords(affiliation).trim();
  if (!a) return true;
  if (t.includes(` ${a} `)) return true;
  const affWords = a.split(" ");
  // Its first distinctive word stands in for the full name ("UCLA Health" -> "ucla").
  const key = affWords.find((w) => w.length >= 3 && !GENERIC_ORG_WORDS.has(w));
  if (key && t.includes(` ${key} `)) return true;
  const textWords = t.trim().split(" ");
  // "UCLA" in the anchor, "University of California, Los Angeles" in the text.
  for (const raw of affiliation.split(/[\s,]+/)) {
    if (/^[A-Z]{3,6}$/.test(raw) && spellsAcronym(textWords, raw.toLowerCase())) return true;
  }
  // The reverse: a full name in the anchor, its acronym in the text.
  const initials = affWords.filter((w) => !CONNECTORS.has(w)).map((w) => w[0]).join("");
  return initials.length >= 3 && textWords.includes(initials);
}
