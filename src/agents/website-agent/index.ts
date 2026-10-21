import {
  CompanyAnchor,
  CompanyProfile,
  LeadershipEntry,
  ProductEntry,
  Source,
  WebsiteAgentResult,
} from "../../types/research.js";
import {
  FetchProvider,
  SearchProvider,
  resolveAndFetch,
  extractBestChunk,
  fetchPageText,
} from "../../lib/providers.js";
import {
  extractPeopleWithTitles,
  extractProductCandidates,
  cleanProducts,
  PRODUCT_STOPWORDS,
} from "../../lib/nlp.js";
import { mentionsCompany, normalizeWords } from "../../lib/news-noise.js";
import { cityOf, detectClosure } from "../../lib/closure.js";
import { hostOf, tiedToSubject } from "../../lib/entities/subject.js";

const FILLER_WORDS = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "on", "at", "by", "with", "our", "&"]);
const wordSet = (t: string) => new Set(normalizeWords(t).trim().split(" "));

/** The first text that contains every word of `name`: where the item came
 *  from. Undefined when no tied source names it. */
function sourceFor(name: string, texts: { words: Set<string>; url: string }[]): string | undefined {
  const words = normalizeWords(name).trim().split(" ").filter((w) => w && !FILLER_WORDS.has(w));
  if (words.length === 0) return undefined;
  return texts.find((t) => words.every((w) => t.words.has(w)))?.url;
}

// The extracted description calls the business a chain or franchise.
const CHAIN_DESCRIPTION = /\b(chain|franchis\w*|\d+\+? locations)\b/i;

// A brand site's location finder or franchise pages: a location search
// that lands here is reading the brand, not the location.
const BRAND_SITE = /\b(our locations|all locations|find a (?:store|location|restaurant)|store locator|franchis(?:e|ing) opportunit)/i;
import { CompanyExtractionSchema, extractStructured } from "../../lib/llm.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";

// Domains that should never be treated as a company's official website
// even if they rank first in search results for "X official website".
const NON_OFFICIAL_DOMAINS = new Set([
  "wikipedia.org",
  "en.wikipedia.org",
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "crunchbase.com",
  "bloomberg.com",
  "reuters.com",
  "forbes.com",
  "techcrunch.com",
  "reddit.com",
  "yelp.com",
  "glassdoor.com",
  "indeed.com",
  "pitchbook.com",
  "tracxn.com",
]);

function isOfficialDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return !NON_OFFICIAL_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

// isRejectedDomain moved to src/entity-validation.ts (7/20) — now shared
// across corporate-agent, news-agent, and competitor-agent too, not just
// this file. See that file's doc comment for why.

/**
 * Strips common nav/header noise patterns from raw page text before
 * sending to the LLM. JS-rendered sites often have very little real
 * content in static HTML — what they do have is navigation menus,
 * "Skip to main content" links, language selectors, and JS fragments.
 * Removing these makes the LLM's job meaningfully easier and prevents
 * the Executive Summary from reading like a site map.
 */
function trimToSentence(text: string, maxChars = 500): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastEnd = Math.max(
    trimmed.lastIndexOf(". "),
    trimmed.lastIndexOf("! "),
    trimmed.lastIndexOf("? ")
  );
  return lastEnd > 100 ? trimmed.slice(0, lastEnd + 1) : trimmed;
}

function cleanPageText(text: string): string {
  return text
    // Remove JS fragments that leak through
    .replace(/\{[^}]{0,200}\}/g, " ")
    // Remove "Skip to X" / "Back to X" nav patterns
    .replace(/\b(Skip to|Back to|Go to|Jump to|Return to)\s+\S+/gi, " ")
    // Remove standalone nav keywords
    .replace(/\b(Sign in|Sign up|Log in|Log out|Contact Us|Translate|Menu|Search|Close|Open)\b/gi, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cleans a leadership name/title field extracted by the LLM or heuristic
 * fallback. Strips stray markdown bold markers and trailing dash
 * fragments that occasionally leak through when a source page's
 * "meet the team" text runs multiple people together (e.g.
 * "**Cassandra Paniagua, M.S., BCBA** —" or "Iknoian** —").
 */
function cleanLeadershipField(value: string): string {
  return value
    .replace(/\*\*/g, "")           // strip markdown bold
    .replace(/\s*—\s*$/, "")        // strip trailing dash fragments
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Website Agent
 * Collects: description, founded/HQ/industry, leadership, products.
 *
 * Sourcing: official site (direct guess -> search fallback) for
 * overview text, plus separate searches for leadership and products
 * (homepages rarely list either in usable form).
 *
 * Extraction: tries a local LLM (Ollama, see lib/llm.ts) first — it
 * reads the combined text and returns structured JSON, which handles
 * cases regex/NLP fundamentally can't (e.g. distinguishing a real
 * product name from marketing copy, writing an actual summary instead
 * of slicing raw text). If Ollama isn't running or the call fails for
 * any reason, falls back automatically to the heuristic extraction
 * (lib/nlp.ts) that was already here — the agent never errors out
 * just because the LLM is unavailable.
 */
export class WebsiteAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  private guessDomain(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9& ]/g, "")
      .replace(/\s*&\s*/g, "and")
      .replace(/\s+/g, "");
    return `https://www.${slug}.com`;
  }

  /** The page, or its contact page, names the city: the site belongs to
   *  the business at that location, not a same-named one elsewhere. */
  private async siteMatchesCity(page: { url: string; text: string }, city: string): Promise<boolean> {
    const has = (t: string | null | undefined) => !!t && normalizeWords(t).includes(normalizeWords(city));
    if (has(page.text)) return true;
    let origin: string;
    try { origin = new URL(page.url).origin; } catch { return false; }
    for (const path of ["/contact", "/contact-us"]) {
      if (has(await fetchPageText(`${origin}${path}`, this.fetcher, 4000))) return true;
    }
    return false;
  }

  /**
   * @param anchor What the user gave to pin down which business (Fix 1).
   *   A website replaces the domain guess; a location narrows every
   *   search, and a site that doesn't name that city is not used.
   */
  async run(companyName: string, anchor: CompanyAnchor = {}): Promise<WebsiteAgentResult> {
    const sources: Source[] = [];
    // The user saw the same-named businesses and none was theirs: nothing
    // found by name alone can be trusted to be about it.
    if (anchor.unlisted) {
      return { company: { name: companyName, anchor, thin: true }, leadership: [], products: [], sources };
    }
    const override = findOverride(companyName);
    const city = cityOf(anchor.location);
    const loc = anchor.location ? ` ${anchor.location}` : "";
    // A known override's own domain is a better direct guess than the
    // generic slugify-the-name heuristic (e.g. "Alan Health" -> guessed
    // "alanhealth.com", which either doesn't resolve or isn't the real
    // site — the override already knows it's alanmeds.com).
    const directUrl = anchor.website
      ? anchor.website
      : override
        ? `https://${override.canonical_domain}`
        : this.guessDomain(companyName);

    // 7/20 hardening — exclude a known-wrong domain (e.g. alan.com) at
    // the query itself via Serper/Google's -site: operator, on top of
    // the isRejectedDomain post-filter below. Query-level exclusion
    // means the result-count budget (5, 3, etc per call) isn't partly
    // spent on hits that were only going to be dropped anyway.
    const [pageRaw, leadershipResultsRaw, productResultsRaw, overviewResultsRaw, locationResultsRaw] =
      await Promise.all([
        resolveAndFetch(
          directUrl,
          appendDomainExclusions(`${companyName}${loc} official website`, override),
          this.fetcher,
          this.searcher
        ),
        this.searcher.search(appendDomainExclusions(`${companyName}${loc} CEO founder executive leadership team`, override), 5),
        this.searcher.search(appendDomainExclusions(`${companyName}${loc} products and services`, override), 5),
        this.searcher.search(appendDomainExclusions(`${companyName}${loc} overview what is`, override), 3),
        // The location itself (Fix 4): its listing carries the address and
        // "permanently closed", which the brand's own site never says.
        anchor.location
          ? this.searcher.search(`"${companyName}" ${anchor.location} address hours`, 5)
          : Promise.resolve([]),
      ]);

    // Drop any result whose domain is on this entity's reject list before
    // it can influence sources, the LLM prompt, or the heuristic fallback.
    let page = pageRaw && !isRejectedDomain(pageRaw.url, override) ? pageRaw : null;
    // Anchor fields must agree: with a city given, a site that never names
    // it is a same-named business elsewhere, so neither its URL nor its
    // text goes into the report. A website the user typed is trusted.
    if (page && city && !anchor.website && !(await this.siteMatchesCity(page, city))) {
      console.log(`[website-agent] "${companyName}" — ${page.url} doesn't name ${city}; not used`);
      page = null;
    }
    const leadershipResults = leadershipResultsRaw.filter((r) => !isRejectedDomain(r.url, override));
    const productResults = productResultsRaw.filter((r) => !isRejectedDomain(r.url, override));
    const overviewResults = overviewResultsRaw.filter((r) => !isRejectedDomain(r.url, override));
    const locationResults = locationResultsRaw.filter((r) => !isRejectedDomain(r.url, override));

    const company: CompanyProfile = { name: companyName };
    if (anchor.location || anchor.website) company.anchor = anchor;

    if (page) {
      // Search snippets mean the site itself was never reached, so the
      // guessed domain isn't shown as the website unless the user gave it.
      const resolvedUrl = page.fromSnippets ? directUrl : page.url;
      if (!page.fromSnippets || anchor.website) {
        company.website = isOfficialDomain(resolvedUrl) ? resolvedUrl : directUrl;
      }
      // Snippets only: the guessed domain still counts when search results
      // come from it (the site exists, it just didn't serve this fetcher).
      const guessedHost = hostOf(directUrl);
      if (page.fromSnippets && !company.website && guessedHost
        && [...overviewResults, ...leadershipResults, ...productResults, ...locationResults].some((r) => hostOf(r.url) === guessedHost)) {
        company.website = directUrl.replace("://www.", "://");
      }
      if (city && !page.fromSnippets && BRAND_SITE.test(page.text)) company.brandLevel = true;
      sources.push({
        url: page.url,
        title: companyName,
        retrievedAt: new Date().toISOString(),
        usedFor: ["overview"],
      });
    }
    for (const r of leadershipResults) {
      sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: ["leadership"] });
    }
    for (const r of productResults) {
      sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: ["products"] });
    }
    for (const r of overviewResults) {
      sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: ["overview"] });
    }

    // Fetch full page text for the top leadership/product results — "meet
    // the team" and product pages are usually much richer than a snippet
    // (which often just truncates a list of names), same pattern as
    // people-agent/news-agent.
    const [leadershipPages, productPages] = await Promise.all([
      Promise.all(leadershipResults.slice(0, 2).map((r) => fetchPageText(r.url, this.fetcher, 2000))),
      Promise.all(productResults.slice(0, 2).map((r) => fetchPageText(r.url, this.fetcher, 2000))),
    ]);

    // Combine everything gathered into one block for a single LLM call
    const combinedText = [
      page ? `OFFICIAL SITE TEXT:\n${extractBestChunk(cleanPageText(page.text), 2000)}` : "",
      overviewResults.length
        ? `OVERVIEW SEARCH:\n${overviewResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}`
        : "",
      leadershipResults.length
        ? `LEADERSHIP SEARCH RESULTS:\n${[
            leadershipPages.map((t, i) => (t ? `FULL PAGE (${leadershipResults[i].url}):\n${t}` : "")).filter(Boolean).join("\n\n"),
            leadershipResults.filter((_r, i) => i >= 2 || !leadershipPages[i]).map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n"),
          ].filter(Boolean).join("\n\n")}`
        : "",
      productResults.length
        ? `PRODUCTS SEARCH RESULTS:\n${[
            productPages.map((t, i) => (t ? `FULL PAGE (${productResults[i].url}):\n${t}` : "")).filter(Boolean).join("\n\n"),
            productResults.filter((_r, i) => i >= 2 || !productPages[i]).map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n"),
          ].filter(Boolean).join("\n\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    let leadership: LeadershipEntry[] = [];
    let products: ProductEntry[] = [];
    let usedLLM = false;

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a business research assistant extracting verified facts about "${companyName}" from search results and website text.

CRITICAL RULES — violations undermine credibility:
- description: 1-2 sentences maximum. State what the company DOES and who it serves. No filler phrases like "well-positioned", "leading provider", "innovative solutions", "leverages cutting-edge". Use plain, specific language. If you can't describe what they do specifically, return a blank description rather than a generic one.
- founded: year only, as a string (e.g. "2012"). If unknown, omit.
- headquarters: city and state/country only. If unknown, omit.
- industry: specific sector (e.g. "Revenue-Based Financing" not just "Fintech"). Be precise.
- leadership: extract ALL named executives with their exact titles. Include CEO, founders, presidents, CFOs, CTOs. Only include people explicitly named in the source text — do NOT invent or guess names. Return each person as their own separate {name, title} object — a "meet the team" page often lists several people in one paragraph; do NOT merge two people into a single entry or split one person's name across two entries. name and title must be plain text only: no markdown (no "**", no bullet "-" or "—" characters), no trailing punctuation, and no credentials or extra names appended after the title.
- products: only include named products or services explicitly mentioned. Do NOT include generic descriptions like "cloud platform" or "SaaS solution" unless a specific product name is given.

Return only facts that are explicitly stated in the source text. Omit fields where the data is absent or ambiguous rather than filling them with guesses.`,
        combinedText,
        CompanyExtractionSchema
      );

      if (llmResult) {
        usedLLM = true;
        if (llmResult.description) company.description = llmResult.description;
        if (llmResult.founded) company.founded = llmResult.founded;
        if (llmResult.headquarters) company.headquarters = llmResult.headquarters;
        if (llmResult.industry) company.industry = llmResult.industry;
        if (llmResult.leadership) {
          leadership = llmResult.leadership
            .map((l) => ({
              name: cleanLeadershipField(l.name),
              title: cleanLeadershipField(l.title),
            }))
            .filter((l) => l.name.length > 0 && l.name.length < 80);
        }
        if (llmResult.products) {
          products = cleanProducts(llmResult.products.map((p) => ({
            name: p.name,
            description: p.description,
          })), companyName, combinedText);
        }
      }
    }

    // Heuristic fallback — use search snippets instead of raw page text
    // since page text is often nav-menu noise for JS-rendered sites.
    if (!usedLLM || !company.description) {
      const snippetDesc = trimToSentence(
        overviewResults
          .map((r) => r.snippet)
          .filter(Boolean)
          .join(" "),
        500
      ).trim();
      if (snippetDesc) {
        company.description = snippetDesc;
      } else if (page) {
        company.description = trimToSentence(cleanPageText(page.text), 500).trim();
      }
    }

    if (leadership.length === 0) {
      const seenLeaders = new Set<string>();
      for (const r of leadershipResults) {
        const text = `${r.title}. ${r.snippet ?? ""}`;
        for (const p of extractPeopleWithTitles(text)) {
          // Dedupe on the cleaned name, not the raw extraction — two
          // extractions of the same person can differ by a trailing
          // artifact ("Brian Schimpf" vs "Brian Schimpf -") that
          // cleanLeadershipField would normalize away, but a dedup key
          // built before cleaning treats them as different people.
          const cleanedName = cleanLeadershipField(p.name);
          const key = cleanedName.toLowerCase();
          if (seenLeaders.has(key)) continue;
          seenLeaders.add(key);
          leadership.push({
            name: cleanedName,
            title: cleanLeadershipField(p.title),
          });
        }
      }
    }

    if (products.length === 0) {
      const seenProducts = new Set<string>();
      for (const r of productResults) {
        const text = `${r.title} ${r.snippet ?? ""}`;
        for (const name of extractProductCandidates(text)) {
          const lower = name.toLowerCase();
          const companyLower = companyName.toLowerCase();
          if (lower === companyLower) continue;
          const words = name.split(/\s+/);
          const nonCompanyWords = words.filter(
            (w) => w.toLowerCase() !== companyLower
          );
          if (
            nonCompanyWords.length < words.length &&
            nonCompanyWords.every((w) => PRODUCT_STOPWORDS.has(w))
          ) {
            continue;
          }
          if (seenProducts.has(lower)) continue;
          seenProducts.add(lower);
          products.push({ name });
          if (products.length >= 10) break;
        }
        if (products.length >= 10) break;
      }
    }

    products = cleanProducts(products, companyName);

    // Every leader and product links to a page tied to this company (its
    // own site, or one naming it and the city); anything else is dropped.
    const subject = { name: companyName, anchor, domain: hostOf(company.website) };
    // A location search that turns up the brand's own franchise or
    // locations pages is a location of a larger brand (Fix 4).
    if (city && !company.brandLevel && (CHAIN_DESCRIPTION.test(company.description ?? "")
      || [...overviewResults, ...leadershipResults, ...productResults]
        .some((r) => (hostOf(r.url) === subject.domain || mentionsCompany(r.title, companyName)) && BRAND_SITE.test(`${r.title} ${r.snippet ?? ""}`)))) {
      company.brandLevel = true;
    }
    const tiedTexts = [
      ...(page && !page.fromSnippets ? [{ text: page.text, url: page.url }] : []),
      ...leadershipPages.map((t, i) => ({ text: t ?? "", url: leadershipResults[i]?.url ?? "" })),
      ...productPages.map((t, i) => ({ text: t ?? "", url: productResults[i]?.url ?? "" })),
      ...[...leadershipResults, ...productResults, ...overviewResults, ...locationResults]
        .map((r) => ({ text: `${r.title}. ${r.snippet ?? ""}`, url: r.url })),
    ].filter((t) => t.text && t.url && tiedToSubject(t.text, t.url, subject))
      .map((t) => ({ words: wordSet(t.text), url: t.url }));
    leadership = leadership
      .map((l) => ({ ...l, sourceUrl: sourceFor(l.name, tiedTexts) }))
      .filter((l) => l.sourceUrl);
    products = products
      .map((p) => ({ ...p, sourceUrl: sourceFor(p.name, tiedTexts) }))
      .filter((p) => p.sourceUrl);

    // Never echo the query as a finding: the city the user typed is the
    // headquarters only if a source used here names it.
    const locationText = locationResults.map((r) => `${r.title} ${r.snippet ?? ""}`).join("\n");
    if (anchor.location) {
      const hqNamesCity = !!company.headquarters && normalizeWords(company.headquarters).includes(normalizeWords(city!));
      if (!hqNamesCity) {
        company.headquarters = anchor.location;
        if (!normalizeWords(`${combinedText}\n${locationText}`).includes(normalizeWords(city!))) company.headquartersUnverified = true;
      }
    }

    company.closure = detectClosure([
      ...(page && !page.fromSnippets ? [{ text: page.text, url: page.url }] : []),
      ...[...locationResults, ...overviewResults, ...leadershipResults, ...productResults].map((r) => ({ text: `${r.title}. ${r.snippet ?? ""}`, url: r.url })),
    ], companyName, city);

    // No website could be tied to this business: say so plainly instead
    // of filling the report from whatever shares the name (Fix 1).
    if (!page) {
      company.thin = true;
      delete company.description;
      return { company, leadership: [], products: [], sources: [] };
    }

    // Section citations list only pages about this company: its own site,
    // or a page whose title names it (a same-named or unrelated page out).
    const cited = sources.filter((s) => {
      const host = hostOf(s.url);
      return (!!subject.domain && !!host && (host === subject.domain || host.endsWith(`.${subject.domain}`)))
        || mentionsCompany(s.title ?? "", companyName);
    });

    return { company, leadership, products, sources: cited };
  }
}