import { SearchProvider } from "./providers.js";

/**
 * Office-type classifier (political research fix #1) — routes a query to
 * the right downstream sources before the orchestrator dispatches to
 * Congress.gov / OpenFEC / LegiScan / the statewide-executives table.
 *
 * Why this exists: prior to this, every political search hit Congress.gov
 * and OpenFEC regardless of whether the person was a federal official —
 * both are federal-only APIs, so a governor or state senator search would
 * silently get zero data back from two of four sources every time. Not
 * wrong, just wasted calls and a missed opportunity to route governors to
 * a source that actually has them (see statewide-executives.ts).
 *
 * Deliberately a cheap heuristic, not an LLM call — office titles are a
 * closed, well-known vocabulary, so keyword matching is fast, free, and
 * plenty accurate for a ROUTING decision (not for anything that ends up
 * directly in a report). "unknown" is always the safe fallback: the
 * orchestrator treats it as "try every source," identical to this
 * classifier not existing at all — so a wrong or missed classification
 * only ever costs a few wasted API calls, never a missing result.
 */

export type OfficeType = "federal" | "state-legislator" | "statewide-executive" | "local" | "unknown";

const FEDERAL_PATTERNS =
  /\bu\.?\s?s\.?\s*senat(e|or)\b|\bu\.?\s?s\.?\s*(house|representative)\b|\bmember of congress\b|\bcongressman\b|\bcongresswoman\b|\bcongressional\b|\bu\.?\s?s\.?\s*house of representatives\b/i;

const STATEWIDE_EXEC_PATTERNS =
  /\bgovernor\b|\blieutenant governor\b|\blt\.?\s*governor\b|\battorney general\b|\bsecretary of state\b|\bstate treasurer\b|\bstate comptroller\b|\bstate auditor\b/i;

const STATE_LEGISLATOR_PATTERNS =
  /\bstate senat(e|or)\b|\bstate (house|assembly)\b|\bstate representative\b|\bassemblymember\b|\bassemblyman\b|\bassemblywoman\b|\bstate legislat(ure|or)\b|\bhouse of delegates\b/i;

const LOCAL_PATTERNS =
  /\bmayor\b|\bcity council\b|\bcity councilmember\b|\bcounty (commissioner|supervisor|executive)\b|\bschool board\b|\bcounty council\b/i;

/** Pure text classifier — exported separately so callers with existing search snippets don't need a second fetch. */
export function classifyOfficeText(text: string): OfficeType {
  // Order matters: check the more specific "statewide executive" bucket
  // before "federal" — a governor's bio will often also mention "former
  // U.S. Senator" or similar, and current statewide-executive status is
  // usually the more useful routing signal for someone actively holding
  // that office today.
  if (STATEWIDE_EXEC_PATTERNS.test(text)) return "statewide-executive";
  if (FEDERAL_PATTERNS.test(text)) return "federal";
  if (STATE_LEGISLATOR_PATTERNS.test(text)) return "state-legislator";
  if (LOCAL_PATTERNS.test(text)) return "local";
  return "unknown";
}

/** Runs a small dedicated search and classifies from the results. */
export async function classifyOfficeType(name: string, searcher: SearchProvider): Promise<OfficeType> {
  try {
    const results = await searcher.search(`${name} elected official current office title`, 5);
    const text = results.map((r) => `${r.title} ${r.snippet ?? ""}`).join(" ");
    if (!text.trim()) return "unknown";
    return classifyOfficeText(text);
  } catch {
    return "unknown";
  }
}
