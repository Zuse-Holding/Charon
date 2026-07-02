import { NewsAgentResult, NewsEntry, Source } from "../../types/research.js";
import { FetchProvider, SearchProvider } from "../../lib/providers.js";

/**
 * News Agent
 * Collects: recent announcements, press releases, interviews, partnerships.
 *
 * Sprint 1 scope: search-only (no direct-URL guessing makes sense for
 * news), returns raw search hits as NewsEntry stubs with snippet as
 * summary. Full Source Citation Engine (de-duping, recency ranking,
 * publisher trust scoring) is Sprint 2 per the roadmap.
 */
export class NewsAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(companyName: string): Promise<NewsAgentResult> {
    const currentYear = new Date().getFullYear();
    const results = await this.searcher.search(
      `"${companyName}" news ${currentYear}`,
      7
    );

    // Filter out generic media/platform results that aren't actually
    // about the company — common noise from search snippets
    const NOISE_DOMAINS = ["youtube.com", "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com"];
    const filtered = results.filter(r => !NOISE_DOMAINS.some(d => r.url?.includes(d)));

    const news: NewsEntry[] = filtered.slice(0, 5).map((r) => ({
      headline: r.title,
      summary: r.snippet,
      url: r.url,
    }));

    const sources: Source[] = filtered.slice(0, 5).map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["news"],
    }));

    return { news, sources };
  }
}
