import { CompanyAnchor, NewsAgentResult, NewsEntry, Source } from "../../types/research.js";
import { FetchProvider, SearchProvider, extractBestChunk, htmlToText } from "../../lib/providers.js";
import { findOverride, isRejectedDomain, appendDomainExclusions } from "../../entity-validation.js";
import { brandName, isEnforcementAction, isEnforcementSource, isLawFirmSolicitation, isPersonalLifeNews, isPlaceNamesake, publishedDate, isShoppingOrQuote, namesItself, isNewsIndexPage, isNewsNoise, isUsableHeadline, mentionsCompany, newsDate, outletFromUrl } from "../../lib/news-noise.js";

export { brandName };

// A company event: a short-name headline with one of these is business news.
const BUSINESS_EVENT = /\b(ceo|president|chief executive|names|appoints|promotes|acquires|acquisition|merger|earnings|revenue|quarter|results|layoffs?|lays off|closes|closing|expands|expansion|contract|lawsuit|sued|settles|ipo|raises|funding|headquarters|employees|stores|locations|franchise\w*)\b/i;

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
  /** @param opts.aliases Short names, only for a national brand (launch fix 61:
   *   "Promise" alone matched the Dream and Promise Act).
   *  @param opts.profileTerms Words about the business (industry, city,
   *   people); a match on a short name alone must include one. */
  async run(companyName: string, anchor: CompanyAnchor = {}, domain?: string, opts: { aliases?: string[]; profileTerms?: string[] } = {}): Promise<NewsAgentResult> {
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
    const alias = opts.aliases?.[0];
    const terms = (opts.profileTerms ?? []).map((t) => t.toLowerCase()).filter((t) => t.length >= 4);
    const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    // About this company: on its own site, or naming it as itself (not a
    // longer name that contains it), and when only the short name matches,
    // also saying something about the business (launch fix 61).
    const aboutIt = (r: { title: string; snippet?: string; url: string }) => {
      const text = `${r.title} ${r.snippet ?? ""}`;
      if (domain && (host(r.url) === domain || host(r.url).endsWith(`.${domain}`))) return true;
      if (mentionsCompany(text, companyName) && namesItself(text, companyName)) return true;
      if (!alias || !mentionsCompany(text, alias) || !namesItself(text, alias)) return false;
      const lower = text.toLowerCase();
      return terms.some((t) => lower.includes(t)) || (!!domain && lower.includes(domain)) || BUSINESS_EVENT.test(text);
    };
    const partyNames = [companyName, ...(alias ? [alias] : [])];
    // A dated or press path on its own site is an article; its home and about pages aren't.
    const isArticlePath = (u: string) => { try { return /\/(news|press|press-releases|blog|media|insights|stories)\/[^/]+|\/20\d{2}\//i.test(new URL(u).pathname); } catch { return false; } };
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
        .filter(r => isUsableHeadline(r.title) && aboutIt(r))
        // An agency page that isn't an action against this company (its own
        // filings, speeches, research) is dropped (launch fix 76).
        .filter(r => !isEnforcementSource(r.url) || isEnforcementAction(r, partyNames))
        .filter(r => !isPersonalLifeNews(r.title, r.snippet, r.url) && !isShoppingOrQuote(r.title, r.url))
        // A place that shares the name (round 15: Patagonia's trek and data centers).
        .filter(r => !partyNames.some((n) => isPlaceNamesake(r.title, r.snippet, n)));
      console.log(`[news] "${companyName}"${where}: ${web.length} web + ${press.length} news result(s), ${filtered.length} about the company`);
      return filtered;
    };
    // Government enforcement (launch fix 62: "United States v. ACCO
    // Engineered Systems" on justice.gov never reached court records or
    // risks): its own search, kept apart from the top-five cut.
    // Located and unlocated together (launch fix 84: ACCO's located search
    // found only 2018-2020 LA items; its Colorado and Arizona news never
    // names the HQ city), newest first.
    // OSHA gets its own search: its inspection pages filled the shared one
    // and pushed out "United States v. ACCO" (launch fix 84).
    const [located, unlocated, dojRaw, actionsRaw, oshaRaw] = await Promise.all([
      lookup(anchor.location),
      anchor.location ? lookup() : Promise.resolve([]),
      this.searcher.search(`"${companyName}" site:justice.gov`, 5),
      this.searcher.search(`"${companyName}" (site:sec.gov OR site:ftc.gov OR site:epa.gov OR site:dol.gov OR site:eeoc.gov)`, 5),
      this.searcher.search(`"${companyName}" site:osha.gov`, 5),
    ]);
    const enforcementRaw = [...dojRaw, ...actionsRaw, ...oshaRaw];
    const seenNews = new Set<string>();
    const merged = [...located, ...unlocated].filter((r) => !seenNews.has(r.url) && !!seenNews.add(r.url));
    // An agency action the news search found belongs with the enforcement
    // items, not at the bottom of the news (launch fix 84: ACCO's DOJ case).
    const filtered = merged
      .filter((r) => !isEnforcementAction(r, partyNames))
      // Its own home, about and service pages aren't news.
      .filter((r) => !domain || !(host(r.url) === domain || host(r.url).endsWith(`.${domain}`)) || isArticlePath(r.url))
      .map((r, i) => ({ r, i, t: Date.parse(newsDate(r.date, r.url) ?? "") }))
      .sort((a, b) => (isNaN(b.t) ? -Infinity : b.t) - (isNaN(a.t) ? -Infinity : a.t) || a.i - b.i)
      .map((x) => x.r);
    // Charges and settlements first, then up to three OSHA inspections: the
    // inspections had crowded out ACCO's DOJ case (launch fix 84).
    const seenAgency = new Set<string>();
    const agency = [...merged, ...enforcementRaw].filter((r) => isEnforcementAction(r, partyNames) && isUsableHeadline(r.title) && aboutIt(r)
      && !partyNames.some((n) => isPlaceNamesake(r.title, r.snippet, n)) && !seenAgency.has(r.url) && !!seenAgency.add(r.url));
    const inspection = (r: { url: string }) => /osha\.gov/i.test(r.url) && /establishment|inspection/i.test(r.url);
    const enforcement = [...agency.filter((r) => !inspection(r)).slice(0, 3), ...agency.filter(inspection).slice(0, 3)];
    if (enforcement.length) console.log(`[news] "${companyName}": ${enforcement.length} enforcement item(s) from agency sites`);
    const top = [...filtered.slice(0, 5), ...enforcement];

    // Every article is read, in parallel: its page states when it was
    // published (round 15: a 2017 Bears Ears story showed as Sep 2026, the
    // crawl date), and its text names the people a "leadership changes"
    // headline doesn't. Agency pages are records, not articles.
    const pages = await Promise.all(top.map((r) => (isEnforcementSource(r.url) ? Promise.resolve(null) : this.fetcher.fetchText(r.url))));
    const fetchedTexts = pages.map((html) => {
      const text = html ? htmlToText(html) : "";
      return text.length >= 120 ? extractBestChunk(text, 2000) : undefined;
    });

    // The report shows headline · outlet · date · link. The fetched text
    // only feeds synthesis and leadership: it's raw extraction (nav, "Ja
    // nuary"-style breaks), not something to print.
    const items: NewsEntry[] = top.map((r, i) => ({
      headline: r.title,
      outlet: outletFromUrl(r.url),
      date: publishedDate(pages[i]) ?? newsDate(r.date, r.url),
      summary: r.snippet,
      articleText: fetchedTexts[i]?.slice(0, 1500) || undefined,
      url: r.url,
      solicitation: isLawFirmSolicitation(r.title, r.snippet) || undefined,
      enforcement: isEnforcementAction(r, partyNames) || undefined,
    }));
    // Articles newest first again, by the dates they state; agency items stay last.
    const time = (n: NewsEntry) => { const t = Date.parse(n.date ?? ""); return isNaN(t) ? -Infinity : t; };
    const articles = items.length - enforcement.length;
    const news = [...items.slice(0, articles).sort((a, b) => time(b) - time(a)), ...items.slice(articles)];

    const sources: Source[] = top.map((r) => ({
      url: r.url,
      title: r.title,
      retrievedAt: new Date().toISOString(),
      usedFor: ["news"],
    }));

    return { news, sources };
  }
}
