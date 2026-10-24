import {
  CompetitorAgentResult,
  CompetitorEntry,
  Source } from "../../types/research.js";
import { hostOf, type SubjectRecord } from "../../lib/entities/subject.js";
import { pageSupports, rankCitable } from "../../lib/source-quality.js";
import { mentionsCompany } from "../../lib/news-noise.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { extractOrganizations } from "../../lib/nlp.js";
import { CompetitorExtractionSchema, extractStructured, PeerClassSchema } from "../../lib/llm.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";

const NON_COMPETITOR_ENTITIES = new Set([
  // Social media platforms
  "youtube", "facebook", "instagram", "tiktok", "twitter", "x", "linkedin",
  "reddit", "pinterest", "snapchat", "whatsapp", "telegram", "discord",
  // Media / publishers
  "bloomberg", "forbes", "techcrunch", "business insider", "the verge",
  "wired", "cnn", "bbc", "reuters", "ap", "wsj", "new york times",
  "medium", "substack", "crunchbase", "wikipedia",
  // General tech platforms / infrastructure
  "google", "apple", "microsoft", "amazon", "meta", "netflix", "spotify",
  "uber", "airbnb", "salesforce", "oracle", "sap", "ibm", "adobe",
  // Generic non-company terms
  "app store", "play store", "github", "slack", "zoom", "notion",
]);

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// Not a company (launch fix 26): Gecko's "competitors" were phrases lifted
// from a news article ("Largest Capital Investment", "Shapiro
// Administration", "U.S").
const NOT_A_COMPANY = /\b(largest|biggest|leading|top|best|administration|department|government|ministry|agency|commission|congress|senate|council|county|city of|state of|federal|national guard|navy|army|air force|university|program|initiative|investment|announcement|report|market|industry|sector|companies|competitors|alternatives)\b/i;
const PLACE_OR_ABBREV = /^(u\.?s\.?a?|u\.?k\.?|e\.?u\.?|america|united states|europe|china|california|texas|new york)$/i;

export function isCompanyName(name: string, companyName: string): boolean {
  const n = name.trim();
  if (n.length < 3 || PLACE_OR_ABBREV.test(n) || /^the\s/i.test(n)) return false;
  if (NOT_A_COMPANY.test(n) && !/\b(inc|llc|corp|corporation|co|company|ltd|group|holdings|technologies|robotics|systems)\.?$/i.test(n)) return false;
  // A name starts with a capital or digit, and isn't a sentence.
  if (!/^[A-Z0-9]/.test(n) || n.split(/\s+/).length > 5) return false;
  return n.toLowerCase() !== companyName.toLowerCase();
}

// Words any firm in a field might use in its name.
const GENERIC_NAME_WORDS = new Set(["inc", "llc", "corp", "co", "company", "group", "the", "and", "of", "services", "service", "solutions",
  "solution", "partners", "associates", "enterprises", "international", "usa", "america", "national", "holdings"]);
const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies)$/, "y").replace(/(es|s)$/, "");

/**
 * A name made only of words that describe the business's own field
 * (launch fix 38): "Building System Solutions LLC" and "Building Systems &
 * Services" for Limbach, a "building systems solutions" firm. They matched
 * the search terms, not the role. A real peer's name has a word of its own
 * ("Comfort Systems USA", "EMCOR").
 */
export function isFieldPhrase(name: string, profile: PeerProfile): boolean {
  const field = new Set([profile.role, profile.industry, profile.description].filter(Boolean).join(" ").split(/[^A-Za-z0-9]+/).map(stem).filter(Boolean));
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w && !GENERIC_NAME_WORDS.has(w.toLowerCase())).map(stem);
  return words.length > 0 && words.every((w) => field.has(w));
}

// Funders, not peers (launch fix 38: Homeboy listed Kaiser Foundation).
const FUNDER_NAME = /\b(foundation|endowment|philanthrop\w*)\b/i;

/** The model's label for how a named organization relates to the business. */
export function isPeer(c: { name: string; relationship?: string }, companyName: string): boolean {
  if (c.relationship && !/^(peer|competitor|direct competitor|rival)$/.test(c.relationship)) return false;
  return !FUNDER_NAME.test(c.name) || FUNDER_NAME.test(companyName);
}

/** What the competitor search knows about the business (launch fix 3). */
export interface PeerProfile {
  role?: string;
  industry?: string;
  description?: string;
  /** "Pasadena, CA" */
  headquarters?: string;
  /** A local or regional business: peers are searched near it. */
  local?: boolean;
  /** Products or services, for classifying what it does. */
  products?: string[];
  /** Competitors its 10-K names, with the filing's URL (launch fix 42). */
  filed?: { names: string[]; url: string };
  /** Listed on a stock exchange: its peers are other listed or national firms. */
  listed?: boolean;
}

/** "Named competitors" pages for a company known beyond its town. */
export function namedPeerQuery(companyName: string, profile: PeerProfile): string | undefined {
  return profile.local ? undefined : `"${companyName}" competitors alternatives`;
}

/** "Pasadena, CA" -> { city: "Pasadena", state: "California" }. */
export function regionOf(location: string | undefined): { city?: string; state?: string } {
  const parts = (location ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  const last = parts[parts.length - 1].replace(/\s+\d{5}.*$/, "");
  const state = STATES[last.toUpperCase()] ?? (Object.values(STATES).includes(last) ? last : undefined);
  return { city: parts.length > 1 || !state ? parts[0] : undefined, state };
}

/** Peer searches by role and region; never the company's own name. */
export function peerQueries(companyName: string, profile: PeerProfile): string[] {
  const role = (profile.role ?? profile.industry ?? "").trim();
  if (!role) return [];
  // The company's own name never goes in (Promise ABA searched as
  // "Promise ABA LLC" found only itself).
  const nameWords = new Set(companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const clean = role.split(/\s+/).filter((w) => !nameWords.has(w.toLowerCase())).join(" ");
  if (!clean) return [];
  const plural = /s$/i.test(clean) ? clean : /(y)$/i.test(clean) && !/[aeiou]y$/i.test(clean) ? `${clean.slice(0, -1)}ies` : `${clean}s`;
  // A listed company's peers by scale (round 15: Limbach's were local shops, not EMCOR or Comfort Systems).
  if (!profile.local) return [`largest ${plural}`, profile.listed ? `publicly traded ${plural} NYSE NASDAQ` : `top ${plural} companies list`];
  const { city, state } = regionOf(profile.headquarters);
  const out: string[] = [];
  if (city) out.push(`${plural} ${city}${state ? ` ${state}` : ""}`);
  if (state) out.push(`largest ${plural} in ${state}`);
  if (out.length === 0) out.push(`largest ${plural}`);
  return out;
}

/**
 * Competitor Agent (launch fix 3): finds the business's peers by what it
 * is and where, not by its name. A contractor's peers are other
 * contractors (ACCO's are EMCOR and Comfort Systems, not Trane, which
 * makes the equipment); a student-housing sponsor's are other sponsors.
 *
 * Source quality (launch P0): forums and other vendors' "alternatives"
 * pages are never read, and a competitor is kept only when a page it
 * cites names it (claim-to-source check).
 */
export class CompetitorAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  /** @param subject The resolved business (Fix 1).
   *  @param profile Its role, industry and region, from the website step. */
  async run(companyName: string, subject: SubjectRecord = { name: companyName, anchor: {} }, profile: PeerProfile = {}): Promise<CompetitorAgentResult> {
    const override = findOverride(companyName);
    // A public company names its competitors in its 10-K (launch fix 42):
    // that list is primary-sourced and beats any search.
    // Its own name in either form ("Graybar" in a Graybar 10-K) is not a peer.
    const filed = (profile.filed?.names ?? []).filter((n) => isCompanyName(n, companyName) && !pageSupports(n, companyName) && !mentionsCompany(companyName, n));
    if (profile.filed && filed.length >= 2) {
      console.log(`[competitors] "${companyName}": ${filed.length} from the 10-K`);
      return {
        competitors: filed.slice(0, 8).map((name) => ({ name, url: profile.filed!.url, note: "named in its 10-K" })),
        sources: [{ url: profile.filed.url, title: "Annual report (10-K): competition", retrievedAt: new Date().toISOString(), usedFor: ["competitors"] }],
      };
    }
    // Everyone else: classify the industry and peer role first (launch fix
    // 42: Gecko's "robotics company" drew a medical AI scribe, Crumbl's
    // "cookie company" drew packaged-food makers), then search that role.
    const cls = await this.classify(companyName, profile);
    const refined: PeerProfile = cls?.peerRole ? { ...profile, role: cls.peerRole } : profile;
    const named = namedPeerQuery(companyName, profile);
    const queries = [...peerQueries(companyName, refined), ...(cls?.peerRole && !profile.local ? [`${cls.peerRole} market key players`] : []), ...(named ? [named] : [])];
    console.log(`[competitors] "${companyName}": ${cls?.naics ? `NAICS ${cls.naics} ${cls.naicsTitle ?? ""}, ` : ""}peers as "${refined.role ?? "unknown"}"; ${queries.length} search(es)`);
    if (queries.length === 0) return { competitors: [], sources: [] };
    const batches = await Promise.all(queries.map((q) => this.searcher.search(appendDomainExclusions(q, override), 6)));
    const seen = new Set<string>();
    const results = rankCitable(batches.flat().filter((r) => {
      if (seen.has(r.url) || isRejectedDomain(r.url, override)) return false;
      seen.add(r.url);
      // The business's own pages don't list its rivals.
      const host = hostOf(r.url);
      return !(subject.domain && host && (host === subject.domain || host.endsWith(`.${subject.domain}`)));
    }), subject.domain);

    // Full text of the two best pages: ranking lists name far more firms
    // than a snippet does.
    const pageTexts = await Promise.all(results.slice(0, 2).map((r) => fetchPageText(r.url, this.fetcher, 4000)));
    const texts = results.map((r, i) => ({ url: r.url, title: r.title, text: `${r.title}. ${r.snippet ?? ""} ${pageTexts[i] ?? ""}` }));
    const combinedText = texts.map((t, i) => `${i < 2 && pageTexts[i] ? "FULL PAGE" : "RESULT"} (${t.url}):\n${t.text}`).join("\n\n");

    let candidates: { name: string; note?: string; relationship?: string }[] = [];
    if (combinedText.length > 0) {
      const what = [refined.role, profile.industry, cls?.naicsTitle && `NAICS ${cls.naics} ${cls.naicsTitle}`].filter(Boolean).join(", ");
      const llmResult = await extractStructured(
        `You are a business research assistant listing direct competitors of "${companyName}"${what ? `, a ${what}` : ""}${profile.local && profile.headquarters ? ` based in ${profile.headquarters}` : ""}.${profile.description ? ` What it does: ${profile.description}` : ""}

STRICT RULES:
- Only companies that do the same kind of work for the same kind of customer${profile.local ? " in the same region" : ""}. A contractor's competitors are other contractors, not the manufacturers whose equipment it installs; an investment sponsor's are other sponsors, not brokers, lenders or property managers.
${profile.local ? "" : `- "${companyName}" operates nationally: only national or multi-region rivals of comparable scale, never a single-city shop or local supplier.\n`}${profile.listed ? `- "${companyName}" is a publicly traded company: list publicly traded rivals and large national firms first.\n` : ""}- Only companies named in the text below. Never add one from memory.
- NEVER include "${companyName}" itself, social media platforms, news publishers, directories, or software vendors unless "${companyName}" is one.
- If you are not confident a company is a direct competitor, exclude it.
- Order by significance: the largest, best-known rivals named in the text first.
- Sort every organization the text names into how it relates to "${companyName}": "peer" (does the same work, a direct competitor), "funder" (gives it money: foundations, donors, investors, lenders), "partner", "customer" or "supplier". Only peers are competitors.
- A name that is just a description of the field ("Building Systems Services") is not a company unless the text shows it is one.
- Return ONE JSON object: {"competitors": [{"name": "...", "relationship": "peer"}]} with 3-8 genuine peers only, or an empty list.`,
        combinedText,
        CompetitorExtractionSchema
      );
      candidates = llmResult?.competitors ?? [];
    }

    if (candidates.length === 0) {
      const counts = new Map<string, number>();
      for (const t of texts) {
        for (const name of extractOrganizations(`${t.title}. ${t.text}`, companyName)) {
          if (NON_COMPETITOR_ENTITIES.has(name.toLowerCase())) continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      // The heuristic fallback reads names out of prose, so a name counts
      // only when two pages give it (launch fix 26).
      candidates = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => ({ name }));
    }

    // Claim-to-source: each competitor links to a page that names it;
    // one no page names is dropped.
    const own = companyName.toLowerCase();
    const competitors: CompetitorEntry[] = [];
    const cited = new Set<string>();
    for (const c of candidates) {
      if (c.name.toLowerCase() === own || pageSupports(c.name, companyName) || NON_COMPETITOR_ENTITIES.has(c.name.toLowerCase())
        || !isCompanyName(c.name, companyName) || !isPeer(c, companyName) || isFieldPhrase(c.name, profile)) continue;
      const at = texts.find((t) => pageSupports(t.text, c.name));
      if (!at || competitors.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) continue;
      competitors.push({ name: c.name, url: at.url });
      cited.add(at.url);
      if (competitors.length >= 8) break;
    }

    console.log(`[competitors] "${companyName}": ${candidates.length} candidate(s), ${competitors.length} kept`);
    const sources: Source[] = results.filter((r) => cited.has(r.url)).map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["competitors"],
    }));
    return { competitors, sources };
  }

  /** NAICS industry and the role its peers share, from what it does. */
  private async classify(companyName: string, profile: PeerProfile) {
    const about = [profile.description && `What it does: ${profile.description}`, profile.industry && `Industry: ${profile.industry}`,
      profile.role && `Role: ${profile.role}`, profile.products?.length && `Sells: ${profile.products.slice(0, 8).join("; ")}`].filter(Boolean).join("\n");
    if (!about) return null;
    return extractStructured(
      `Classify the business "${companyName}" for a competitor search. Return one JSON object:
{"naics": "<6-digit NAICS code>", "naicsTitle": "<its title>", "peerRole": "<3-6 words naming what its direct competitors are, specific enough that a search returns only them, e.g. 'robotic industrial inspection companies', 'cookie and dessert franchise chains', 'commercial HVAC mechanical contractors', 'student housing investment sponsors', 'reentry and job-training nonprofits'>"}
Name the kind of company, never a company name. Never so broad that unrelated companies fit ("robotics companies", "food companies").`,
      about, PeerClassSchema);
  }
}
