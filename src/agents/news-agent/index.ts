import { NewsAgentResult, NewsEntry, Source } from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";

/**
 * News Agent
 * Collects recent news, announcements, and press releases.
 * Fetches full article text for the top 2-3 results so the LLM
 * has real context rather than 2-line snippets. Falls back to
 * snippet-only if fetching fails or times out.
 */
export class NewsAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(companyName: string): Promise<NewsAgentResult> {
    const currentYear = new Date().getFullYear();
    // 7/20 fix — same entity-override reject list website-agent uses, now
    // applied here too, both at the query (-site: exclusion) and as a
    // post-fetch drop below. A generic noise-domain filter alone doesn't
    // catch a wrong-but-legitimate-looking site like alan.com; this
    // needs the per-entity registry specifically.
    const override = findOverride(companyName);
    const results = await this.searcher.search(
      appendDomainExclusions(`"${companyName}" news ${currentYear}`, override),
      7
    );

    const NOISE_DOMAINS = ["youtube.com", "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com"];
    const filtered = results
      .filter(r => !NOISE_DOMAINS.some(d => r.url?.includes(d)))
      .filter(r => !isRejectedDomain(r.url, override));
    const top = filtered.slice(0, 5);

    // Fetch full text for top 2 articles in parallel — gives the LLM
    // real article content instead of snippet fragments
    const fetchedTexts = await Promise.all(
      top.slice(0, 2).map(r => fetchPageText(r.url, this.fetcher, 2000))
    );

    const news: NewsEntry[] = top.map((r, i) => ({
      headline: r.title,
      summary: fetchedTexts[i]
        ? fetchedTexts[i]!.slice(0, 600)  // use full article text if available
        : r.snippet,                        // fall back to snippet
      url: r.url,
    }));

    const sources: Source[] = top.map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["news"],
    }));

    return { news, sources };
  }
}
