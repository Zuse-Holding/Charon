import {
  CompetitorAgentResult,
  CompetitorEntry,
  Source } from "../../types/research.js";
import { hostOf, type SubjectRecord } from "../../lib/entities/subject.js";
import { pageSupports, rankCitable } from "../../lib/source-quality.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { extractOrganizations } from "../../lib/nlp.js";
import { CompetitorExtractionSchema, extractStructured } from "../../lib/llm.js";
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

const STATES: Record<string, string> = {
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

/** What the competitor search knows about the business (launch fix 3). */
export interface PeerProfile {
  role?: string;
  industry?: string;
  description?: string;
  /** "Pasadena, CA" */
  headquarters?: string;
  /** A local or regional business: peers are searched near it. */
  local?: boolean;
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
  if (!profile.local) return [`largest ${plural}`, `top ${plural} companies list`];
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
    const queries = peerQueries(companyName, profile);
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

    let candidates: { name: string; note?: string }[] = [];
    if (combinedText.length > 0) {
      const what = [profile.role, profile.industry].filter(Boolean).join(", ");
      const llmResult = await extractStructured(
        `You are a business research assistant listing direct competitors of "${companyName}"${what ? `, a ${what}` : ""}${profile.local && profile.headquarters ? ` based in ${profile.headquarters}` : ""}.${profile.description ? ` What it does: ${profile.description}` : ""}

STRICT RULES:
- Only companies that do the same kind of work for the same kind of customer${profile.local ? " in the same region" : ""}. A contractor's competitors are other contractors, not the manufacturers whose equipment it installs; an investment sponsor's are other sponsors, not brokers, lenders or property managers.
- Only companies named in the text below. Never add one from memory.
- NEVER include "${companyName}" itself, social media platforms, news publishers, directories, or software vendors unless "${companyName}" is one.
- If you are not confident a company is a direct competitor, exclude it.
- Order by significance: the largest, best-known rivals named in the text first.
- Return 3-8 genuine direct competitors only, or none.`,
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
        || !isCompanyName(c.name, companyName)) continue;
      const at = texts.find((t) => pageSupports(t.text, c.name));
      if (!at || competitors.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) continue;
      competitors.push({ name: c.name, url: at.url });
      cited.add(at.url);
      if (competitors.length >= 8) break;
    }

    const sources: Source[] = results.filter((r) => cited.has(r.url)).map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["competitors"],
    }));
    return { competitors, sources };
  }
}
