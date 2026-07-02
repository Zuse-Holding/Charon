import {
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
} from "../../lib/providers.js";
import {
  extractPeopleWithTitles,
  extractProductCandidates,
  PRODUCT_STOPWORDS,
} from "../../lib/nlp.js";
import { CompanyExtractionSchema, extractStructured } from "../../lib/llm.js";

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

  async run(companyName: string): Promise<WebsiteAgentResult> {
    const sources: Source[] = [];
    const directUrl = this.guessDomain(companyName);

    const [page, leadershipResults, productResults, overviewResults] =
      await Promise.all([
        resolveAndFetch(
          directUrl,
          `${companyName} official website`,
          this.fetcher,
          this.searcher
        ),
        this.searcher.search(`${companyName} CEO founder executive leadership team`, 5),
        this.searcher.search(`${companyName} products and services`, 5),
        this.searcher.search(`${companyName} overview what is`, 3),
      ]);

    const company: CompanyProfile = { name: companyName };

    if (page) {
      const resolvedUrl = page.fromSnippets ? directUrl : page.url;
      company.website = isOfficialDomain(resolvedUrl) ? resolvedUrl : directUrl;
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

    // Combine everything gathered into one block for a single LLM call
    const combinedText = [
      page ? `OFFICIAL SITE TEXT:\n${cleanPageText(page.text).slice(0, 1500)}` : "",
      overviewResults.length
        ? `OVERVIEW SEARCH:\n${overviewResults.map((r) => `${r.title}: ${r.snippet ?? ""}`).join("\n")}`
        : "",
      leadershipResults.length
        ? `LEADERSHIP SEARCH RESULTS:\n${leadershipResults
            .map((r) => `${r.title}: ${r.snippet ?? ""}`)
            .join("\n")}`
        : "",
      productResults.length
        ? `PRODUCTS SEARCH RESULTS:\n${productResults
            .map((r) => `${r.title}: ${r.snippet ?? ""}`)
            .join("\n")}`
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
- leadership: extract ALL named executives with their exact titles. Include CEO, founders, presidents, CFOs, CTOs. Only include people explicitly named in the source text — do NOT invent or guess names.
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
          leadership = llmResult.leadership.map((l) => ({
            name: l.name,
            title: l.title,
          }));
        }
        if (llmResult.products) {
          products = llmResult.products.map((p) => ({
            name: p.name,
            description: p.description,
          }));
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
          const key = p.name.toLowerCase();
          if (seenLeaders.has(key)) continue;
          seenLeaders.add(key);
          leadership.push({ name: p.name, title: p.title });
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

    return { company, leadership, products, sources };
  }
}
