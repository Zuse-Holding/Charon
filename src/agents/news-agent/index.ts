import { CompanyAnchor, NewsAgentResult, NewsEntry, Source } from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";
import { brandName, isLawFirmSolicitation, isPersonalLifeNews, isNewsIndexPage, isNewsNoise, isUsableHeadline, mentionsCompany, newsDate, outletFromUrl } from "../../lib/news-noise.js";

export { brandName };

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

  /** @param anchor City/state the user gave (Fix 1): narrows the search
   *  to that business instead of a better-documented namesake.
   *  @param domain The business's website, for the short name the press uses. */
  async run(companyName: string, anchor: CompanyAnchor = {}, domain?: string): Promise<NewsAgentResult> {
    const currentYear = new Date().getFullYear();
    // 7/20 fix — same entity-override reject list website-agent uses, now
    // applied here too, both at the query (-site: exclusion) and as a
    // post-fetch drop below. A generic noise-domain filter alone doesn't
    // catch a wrong-but-legitimate-looking site like alan.com; this
    // needs the per-entity registry specifically.
    const override = findOverride(companyName);
    // Launch fix 36: three of five runs found no news. Headlines say
    // "Graybar", not "Graybar Electric Company", and the general index
    // buries articles under the company's own pages, so the news index is
    // searched too, by the short name, and a located search that finds
    // nothing is tried once without the city.
    const alias = brandName(companyName, domain);
    const names = [companyName, ...(alias ? [alias] : [])];
    const lookup = async (location?: string) => {
      const where = location ? ` ${location}` : "";
      const [web, press] = await Promise.all([
        this.searcher.search(appendDomainExclusions(`"${companyName}"${where} news ${currentYear}`, override), 7),
        this.searcher.news ? this.searcher.news(appendDomainExclusions(`"${alias ?? companyName}"${where}`, override), 10) : Promise.resolve([]),
      ]);
      const seen = new Set<string>();
      const results = [...press, ...web].filter((r) => !seen.has(r.url) && !!seen.add(r.url));
      const filtered = results
        .filter(r => !isNewsNoise(r.url) && !isNewsIndexPage(r.url))
        .filter(r => !isRejectedDomain(r.url, override))
        // An item must have a real headline and name this company; a hit
        // that only matched loosely is usually about someone else.
        .filter(r => isUsableHeadline(r.title) && names.some((n) => mentionsCompany(`${r.title} ${r.snippet ?? ""}`, n)))
        .filter(r => !isPersonalLifeNews(r.title, r.snippet, r.url));
      console.log(`[news] "${companyName}"${where}: ${web.length} web + ${press.length} news result(s), ${filtered.length} about the company`);
      return filtered;
    };
    let filtered = await lookup(anchor.location);
    if (filtered.length === 0 && anchor.location) filtered = await lookup();
    const top = filtered.slice(0, 5);

    // Fetch full text for top 2 articles in parallel — gives the LLM
    // real article content instead of snippet fragments
    const fetchedTexts = await Promise.all(
      top.slice(0, 2).map(r => fetchPageText(r.url, this.fetcher, 2000))
    );

    // The report shows headline · outlet · date · link. The fetched text
    // only feeds synthesis: it's raw extraction (nav, "Ja nuary"-style
    // breaks), not something to print.
    const news: NewsEntry[] = top.map((r, i) => ({
      headline: r.title,
      outlet: outletFromUrl(r.url),
      date: newsDate(r.date, r.url),
      summary: r.snippet,
      articleText: fetchedTexts[i]?.slice(0, 600) || undefined,
      url: r.url,
      solicitation: isLawFirmSolicitation(r.title, r.snippet) || undefined,
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
