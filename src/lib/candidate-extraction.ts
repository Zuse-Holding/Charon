// Heuristic candidate extraction for creator-discovery-agent — pulls
// @handles and plausible person-name sequences out of search result
// titles/snippets. No NER model: per the discovery agent's own scope,
// regex/heuristic extraction is fine for v1, precision improves later
// only if it turns out to be a real problem in practice.
//
// looksLikePersonName (entity-validation.ts) is a shape *validator*, not
// an extractor — it only tells you whether an already-isolated string
// has person-name shape. The actual pulling-candidates-out-of-free-text
// step below is new; looksLikePersonName is applied as a filter on what
// this finds, same way handle-resolver-agent already uses it.

import { looksLikePersonName } from "../entity-validation.js";

export interface RawCandidate {
  raw: string; // "@handle" or "Jane Doe", as found
  sourceUrl: string;
  sourceSnippet: string;
}

const HANDLE_PATTERN = /@[a-zA-Z0-9._]{2,30}/g;
// Exactly two capitalized words. An earlier version allowed 2-4 words and
// mostly caught run-on article-title fragments ("Business Leaders Explore
// Forbes") rather than names — real creator/person names are overwhelmingly
// two words, and three-plus-word matches were pure noise in practice, not
// a meaningful source of real candidates worth the extra false positives.
const NAME_PATTERN = /\b[A-Z][a-zA-Z'-]+\s+[A-Z][a-zA-Z'-]+\b/g;

// Common words that end up capitalized at the start of a sentence/title
// and bleed into a name-shaped match as the leading or trailing token
// ("From MrBeast", "Meet Sarah", "Best Creators") — rejecting a match
// where either word is one of these catches that class of false positive
// without needing real NER.
const COMMON_WORD_STOPLIST = new Set([
  "the", "a", "an", "from", "why", "how", "this", "that", "these", "those",
  "meet", "watch", "best", "top", "new", "here", "who", "what", "when",
  "read", "learn", "check", "see", "get", "our", "your", "his", "her",
]);

// Boilerplate that regularly gets swept up by NAME_PATTERN because it's
// literally the phrasing of the search queries themselves ("rising
// creators 2026" -> titles containing "Rising Creators") or generic
// platform/place noise. Not exhaustive — this is a coarse filter for the
// most common false positives, not a precision guarantee.
const STOPLIST = new Set([
  "rising creators", "top creators", "creators to watch", "trending hashtag",
  "creator trends", "remote jobs", "creators to",
  "tiktok", "instagram", "youtube", "twitter", "tiktok hashtag", "tiktok videos",
  "tiktok trending", "trending tiktok", "marketing hashtags",
  "united states", "new york", "los angeles", "san francisco",
  "google trends", "business insider", "read more", "learn more",
]);

function isBoilerplate(candidate: string): boolean {
  const normalized = candidate.trim().toLowerCase();
  if (STOPLIST.has(normalized)) return true;
  if (candidate === candidate.toUpperCase()) return true; // headers/acronyms, e.g. "CREATORS TO"
  return normalized.split(/\s+/).some((word) => COMMON_WORD_STOPLIST.has(word));
}

export function extractCandidates(
  results: { title: string; url: string; snippet?: string }[]
): RawCandidate[] {
  const seen = new Set<string>();
  const candidates: RawCandidate[] = [];

  for (const result of results) {
    const text = `${result.title} ${result.snippet ?? ""}`;

    const handles = text.match(HANDLE_PATTERN) ?? [];
    for (const rawHandle of handles) {
      // Trailing sentence punctuation ("@MrMoneyJar." at the end of a
      // clause) is inside the character class the regex matches on, so it
      // has to be trimmed after the fact rather than excluded from the
      // pattern itself (a bare "." is legitimate mid-handle).
      const handle = rawHandle.replace(/[.,;:!?]+$/, "");
      if (handle.length < 4) continue; // "@ed" etc. — too short to be a meaningful handle
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ raw: handle, sourceUrl: result.url, sourceSnippet: result.snippet ?? result.title });
    }

    const names = text.match(NAME_PATTERN) ?? [];
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key) || isBoilerplate(name) || !looksLikePersonName(name)) continue;
      seen.add(key);
      candidates.push({ raw: name, sourceUrl: result.url, sourceSnippet: result.snippet ?? result.title });
    }
  }

  return candidates;
}
