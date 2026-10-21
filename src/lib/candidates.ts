import type { CompanyAnchor } from "../types/research.js";
import type { PlaceResult, SearchResult } from "./providers.js";
import { mentionsCompany, mentionsPerson, normalizeWords } from "./news-noise.js";
import { hostOf } from "./entities/subject.js";
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
}

export interface CandidateSearcher {
  search(query: string, count?: number): Promise<SearchResult[]>;
  places(query: string): Promise<PlaceResult[]>;
}

export interface CandidateResult {
  candidates: Candidate[];
  /** No match of this type, but the name reads as the other type (item 10). */
  suggestType?: "company" | "person";
}

// Directories, social and reference sites: they list a business, they
// aren't one, so they never become a candidate's website.
const NOT_A_BUSINESS_SITE = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|tiktok|yelp|wikipedia|bbb|bloomberg|crunchbase|zoominfo|dnb|opencorporates|bizapedia|manta|mapquest|yellowpages|indeed|glassdoor|reddit|pinterest|google|apple|amazon|tripadvisor|doordash|ubereats|grubhub|healthgrades|zocdoc|vitals)\.[a-z.]+$/i;

const MAX = 6;

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

export async function companyCandidates(name: string, anchor: CompanyAnchor, searcher: CandidateSearcher): Promise<CandidateResult> {
  const loc = anchor.location ? ` ${anchor.location}` : "";
  const [places, results] = await Promise.all([
    searcher.places(`${name}${loc}`),
    searcher.search(`"${name}"${loc}`, 10),
  ]);

  const out: Candidate[] = [];
  const seenHosts = new Set<string>();
  const seenPlaces = new Set<string>();
  const anchorSuffix = (website?: string, address?: string) => website ?? address;

  for (const p of places) {
    if (!mentionsCompany(p.title, name)) continue;
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
    out.push({
      label: p.title,
      description: [p.address, host].filter(Boolean).join(" · "),
      subject: `${name} · ${pinned}`,
    });
  }

  // A name that reads as a person's ("Doug Shapses UCLA") matches their
  // profile pages too; only a business listing counts as a business then.
  const personLike = looksLikePersonName(name);
  for (const r of personLike ? [] : results) {
    const host = hostOf(r.url);
    if (!host || NOT_A_BUSINESS_SITE.test(host) || seenHosts.has(host) || !ownSite(host, name)) continue;
    if (!mentionsCompany(r.title, name)) continue;
    seenHosts.add(host);
    out.push({
      label: titleHead(r.title) || name,
      description: [host, (r.snippet ?? "").slice(0, 120)].filter(Boolean).join(" · "),
      subject: `${name} · ${host}`,
    });
  }

  const candidates = out.slice(0, MAX);
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
  const results = await searcher.search(`"${name}"${context ? ` ${context}` : ""}`, 10);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    // Profile-style pages lead with the person's name ("Doug Shapses -
    // UCLA Health"); a headline that mentions them isn't a profile.
    const lead = r.title.split(/\s[|\-–—·]\s|,\s/)[0];
    if (!mentionsPerson(lead, name)) continue;
    const org = orgFromTitle(r.title, name);
    if (!org) continue;
    const key = normalizeWords(org);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: `${name} — ${org}`,
      description: [hostOf(r.url), (r.snippet ?? "").slice(0, 120)].filter(Boolean).join(" · "),
      subject: `${name} · ${affiliationOf(org)}`,
    });
    if (out.length >= MAX) break;
  }
  if (out.length > 0) return { candidates: out };
  // Nobody by that name, but businesses are: offer a company search.
  const companies = await companyCandidates(name, {}, searcher);
  return companies.candidates.length > 0 ? { candidates: [], suggestType: "company" } : { candidates: [] };
}
