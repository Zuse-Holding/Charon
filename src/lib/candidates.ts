import type { CompanyAnchor } from "../types/research.js";
import type { PlaceResult, SearchResult } from "./providers.js";
import { mentionsCompany, mentionsPerson, normalizeWords } from "./news-noise.js";
import { hostOf } from "./entities/subject.js";
import { mentionsAffiliation } from "./entities/affiliation.js";
import { looksLikePersonName } from "./nlp.js";

/**
 * Candidate step (Fix 1 item 3, Fix 5): before a report runs, list the
 * businesses or people that share the name so the user picks one. Each
 * candidate's `subject` is what gets researched: "Name · anchor".
 */
export interface Candidate {
  label: string;
  description: string;
  subject: string;
  /** The candidate's name is the searched name, not just close to it
   *  (round 2, Fix 4). Only an exact lone match runs without asking. */
  exact?: boolean;
}

export interface CandidateSearcher {
  search(query: string, count?: number): Promise<SearchResult[]>;
  places(query: string): Promise<PlaceResult[]>;
}

export interface CandidateResult {
  candidates: Candidate[];
  /** No match of this type, but the name reads as the other type (item 10). */
  suggestType?: "company" | "person";
  /** Pages name someone by this name, but none could be confirmed as a
   *  match (round 2, Fix 4): "Couldn't confirm a match", not "no one". */
  namesFound?: boolean;
}

// Directories, social and reference sites: they list a business, they
// aren't one, so they never become a candidate's website.
const NOT_A_BUSINESS_SITE = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|tiktok|yelp|wikipedia|bbb|bloomberg|crunchbase|zoominfo|dnb|opencorporates|bizapedia|manta|mapquest|yellowpages|indeed|glassdoor|reddit|pinterest|google|apple|amazon|tripadvisor|doordash|ubereats|grubhub|healthgrades|zocdoc|vitals)\.[a-z.]+$/i;

// Room for local businesses below the national ones (round 2, Fix 4).
const MAX_COMPANIES = 10;
const MAX_PEOPLE = 6;
// Fewer results than this from an exact-phrase search: also search without
// quotes. Google drops "Doug Shapses" when pages say "Douglas Shapses".
const MIN_RESULTS = 3;

// Words too common in business names to tie a domain to one company.
const GENERIC_NAME_WORDS = new Set(["the", "and", "inc", "llc", "co", "company", "group", "holdings", "health", "services", "studio", "design", "center"]);

/** The domain carries the company's name ("zuseholdings.com" for Zuse
 *  Holdings): its own site, not a directory or news page about it. */
function ownSite(host: string, name: string): boolean {
  const label = host.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  const words = normalizeWords(name).trim().split(" ").filter((w) => w.length >= 3);
  const distinctive = words.filter((w) => !GENERIC_NAME_WORDS.has(w));
  return (distinctive.length ? distinctive : words).some((w) => label.includes(w));
}

/** "Smile Design Studio | Cosmetic Dentist" -> "Smile Design Studio". */
function titleHead(title: string): string {
  return title.split(/\s[|\-–—·:]\s/)[0].trim();
}

/**
 * Close to the searched name without being it (round 2, Fix 4): the
 * first word matches exactly and every other searched word shares a
 * stem with a word of the title ("ACCO Engineering" ~ "ACCO Engineered
 * Systems"). A partial name lists these instead of picking one.
 */
export function nearName(title: string, name: string): boolean {
  const want = normalizeWords(name).trim().split(" ").filter((w) => !GENERIC_NAME_WORDS.has(w));
  const have = normalizeWords(title).trim().split(" ");
  // One distinctive word ("Zuse" of Zuse Holdings) is too little to call
  // another company close: it stays an honest no-match.
  if (want.length < 2 || !have.includes(want[0])) return false;
  const stem = (w: string) => w.slice(0, Math.max(4, Math.min(w.length - 2, 8)));
  return want.slice(1).every((w) => have.some((h) => h === w || (w.length >= 5 && h.startsWith(stem(w)))));
}

/** Search results for the name, quoted first; unquoted when that's thin. */
async function searchName(searcher: CandidateSearcher, name: string, context: string): Promise<SearchResult[]> {
  const quoted = await searcher.search(`"${name}"${context}`, 10);
  if (quoted.length >= MIN_RESULTS) return quoted;
  const loose = await searcher.search(`${name}${context}`, 10);
  const seen = new Set(quoted.map((r) => r.url));
  return [...quoted, ...loose.filter((r) => !seen.has(r.url))];
}

export async function companyCandidates(name: string, anchor: CompanyAnchor, searcher: CandidateSearcher): Promise<CandidateResult> {
  const found = await companyCandidatesFor(name, anchor, searcher);
  // "&" is read differently by search engines and listings (launch fix
  // 79): with nothing found, try once more with "and" in its place.
  if (found.candidates.length === 0 && name.includes("&")) {
    return companyCandidatesFor(name.replace(/\s*&\s*/g, " and "), anchor, searcher);
  }
  return found;
}

async function companyCandidatesFor(name: string, anchor: CompanyAnchor, searcher: CandidateSearcher): Promise<CandidateResult> {
  const loc = anchor.location ? ` ${anchor.location}` : "";
  const [places, results] = await Promise.all([
    searcher.places(`${name}${loc}`),
    searchName(searcher, name, loc),
  ]);

  const out: Candidate[] = [];
  const seenHosts = new Set<string>();
  const seenPlaces = new Set<string>();
  const anchorSuffix = (website?: string, address?: string) => website ?? address;

  for (const p of places) {
    const exact = mentionsCompany(p.title, name);
    if (!exact && !nearName(p.title, name)) continue;
    const host = hostOf(p.website);
    const site = host && !NOT_A_BUSINESS_SITE.test(host) ? `https://${host}` : undefined;
    const key = normalizeWords(`${p.title} ${p.address ?? ""}`);
    if (seenPlaces.has(key) || (host && seenHosts.has(host))) continue;
    seenPlaces.add(key);
    if (host) seenHosts.add(host);
    // The listing's city is the anchor when it has no website of its own.
    const city = p.address?.split(",").slice(-2, -1)[0]?.trim();
    const pinned = anchorSuffix(site, city);
    if (!pinned) continue;
    // A near match is researched under its own name, not the typed one.
    out.push({
      label: p.title,
      description: [p.address, host].filter(Boolean).join(" · "),
      subject: `${exact ? name : p.title} · ${pinned}`,
      exact,
    });
  }

  // A name that reads as a person's ("Doug Shapses UCLA") matches their
  // profile pages too; only a business listing counts as a business then.
  const personLike = looksLikePersonName(name);
  for (const r of personLike ? [] : results) {
    const host = hostOf(r.url);
    if (!host || NOT_A_BUSINESS_SITE.test(host) || seenHosts.has(host) || !ownSite(host, name)) continue;
    const exact = mentionsCompany(r.title, name);
    if (!exact && !nearName(r.title, name)) continue;
    seenHosts.add(host);
    const label = titleHead(r.title) || name;
    out.push({
      label,
      description: [host, (r.snippet ?? "").slice(0, 120)].filter(Boolean).join(" · "),
      subject: `${exact ? name : label} · ${host}`,
      exact,
    });
  }

  // Exact matches first, so a lone exact match is easy to spot.
  const candidates = [...out.filter((c) => c.exact), ...out.filter((c) => !c.exact)].slice(0, MAX_COMPANIES);
  return candidates.length === 0 && personLike
    ? { candidates, suggestType: "person" }
    : { candidates };
}

const GENERIC_PARTS = /^(linkedin|facebook|instagram|x|twitter|profile|home|about|bio|biography|staff|people|team|directory|news)$/i;

/** The organization in a profile title: "Doug Shapses - UCLA Health | LinkedIn" -> "UCLA Health". */
export function orgFromTitle(title: string, personName: string): string | undefined {
  const parts = title.split(/\s[|\-–—·]\s|,\s/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (mentionsPerson(part, personName) || GENERIC_PARTS.test(part) || part.length > 60) continue;
    // A bare job title is the role, not where they work.
    if (/^(ceo|cfo|cto|coo|founder|co-founder|owner|president|director|manager|professor|engineer|attorney|partner|senior .+|vice president.*)$/i.test(part)) continue;
    // Payroll and directory titles: "Real Estate Ofcr 4", "2022".
    if (/\d/.test(part) || /\b(ofcr|officer|analyst|specialist|assistant|coordinator|admin\w*|clerk|technician)\b/i.test(part)) continue;
    return part;
  }
  return undefined;
}

/** "Founder of Reverb" -> "Reverb"; "Engineer at Acme" -> "Acme". A role
 *  "in" a city keeps the role, since the city alone isn't an anchor. */
function affiliationOf(part: string): string {
  return part.match(/^.{2,50}?\s(?:at|of|@)\s(.+)$/i)?.[1].trim() ?? part;
}

export async function personCandidates(name: string, context: string | undefined, searcher: CandidateSearcher): Promise<CandidateResult> {
  const results = await searchName(searcher, name, context ? ` ${context}` : "");
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let namesFound = false;
  for (const r of results) {
    const text = `${r.title} ${r.snippet ?? ""}`;
    if (mentionsPerson(text, name)) namesFound = true;
    // Profile-style pages lead with the person's name ("Doug Shapses -
    // UCLA Health"); a headline that mentions them isn't a profile.
    const lead = r.title.split(/\s[|\-–—·]\s|,\s/)[0];
    if (!mentionsPerson(lead, name)) continue;
    // With an anchor typed, a page counts only if it names that anchor too,
    // and the anchor the user gave is what gets researched (round 2, Fix 2).
    if (context && !mentionsAffiliation(text, context)) continue;
    const org = context ?? orgFromTitle(r.title, name);
    if (!org) continue;
    const key = normalizeWords(context ? `${org} ${r.url}` : org);
    if (seen.has(key)) continue;
    seen.add(key);
    const shown = context ? (orgFromTitle(r.title, name) ?? context) : org;
    out.push({
      label: `${name} — ${shown}`,
      description: [hostOf(r.url), (r.snippet ?? "").slice(0, 120)].filter(Boolean).join(" · "),
      subject: `${name} · ${affiliationOf(org)}`,
    });
    // One anchor means one person: the first confirming page is enough.
    if (context || out.length >= MAX_PEOPLE) break;
  }
  if (out.length > 0) return { candidates: out };
  if (namesFound) return { candidates: [], namesFound: true };
  // Nobody by that name, but businesses are: offer a company search.
  const companies = await companyCandidates(name, {}, searcher);
  return companies.candidates.length > 0 ? { candidates: [], suggestType: "company" } : { candidates: [] };
}
