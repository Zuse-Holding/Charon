// Provider layer: every agent goes through this instead of calling fetch()
// or a search API directly. This is what makes "mix, with search as
// fallback" actually swappable later without touching agent logic.
//
// Strategy per the chosen sourcing model:
//   1. Try a direct fetch of a known/guessed URL (company site, etc.)
//   2. If that fails or returns nothing useful, fall back to a web search
//      provider to locate and then fetch the right page.
//
// Sprint 1 ships a real DirectFetchProvider and a SearchProvider interface
// with one concrete implementation (Serper.dev, since it's a simple REST
// API with a generous free tier). No key required to run the CLI — if
// SERPER_API_KEY is unset, search calls are skipped and the orchestrator
// degrades gracefully (reports which sections lack data).

import { isRefreshRun, recordSearchCall } from "./cost-tracking.js";

/**
 * Source cache (Fix 3): reruns within the window read the same search
 * results and pages, so the same company gives the same facts. A run
 * marked refresh (the user's "Run again") skips it. Only non-empty
 * results are kept, so a failed call is retried next time.
 */
const CACHE_TTL_MS = Number(process.env.SOURCE_CACHE_HOURS ?? 72) * 3.6e6;

class TtlCache<V> {
  private map = new Map<string, { at: number; value: V }>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    if (isRefreshRun()) return undefined;
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > CACHE_TTL_MS) { this.map.delete(key); return undefined; }
    return hit.value;
  }
  set(key: string, value: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }
}

const searchCache = new TtlCache<SearchResult[]>(5000);
const placesCache = new TtlCache<PlaceResult[]>(1000);
// Raw HTML, so a smaller cap and only pages under 500 KB.
const pageCache = new TtlCache<string>(300);

export interface PlaceResult {
  title: string;
  address?: string;
  website?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  /** Publish date as the search engine reports it ("Aug 19, 2026",
   *  "3 days ago"). Only some providers return one. */
  date?: string;
}

export interface SearchProvider {
  /**
   * @param tbs Optional Google time-based-search filter (Serper passes
   *   this straight through) — "qdr:h" past hour, "qdr:d" past day,
   *   "qdr:w" past week, "qdr:m" past month, "qdr:y" past year. Omit for
   *   no time restriction (existing behavior, unchanged for every caller
   *   that doesn't pass it). Added for creator-signal-agent's short-form
   *   mention search, where freshness is the point — see that agent.
   */
  search(query: string, count?: number, tbs?: string): Promise<SearchResult[]>;
  /** Business listings (name, address, website). Optional: not every
   *  provider has them, and callers treat a missing method as no listings. */
  places?(query: string): Promise<PlaceResult[]>;
  /** News articles, newest first (Serper /news). Optional, like places. */
  news?(query: string, count?: number): Promise<SearchResult[]>;
}

/** A page fetch with the reason it failed, for messages the user sees. */
export interface FetchedPage {
  html: string | null;
  /** "the site returned HTTP 403", "the site didn't respond in time"... */
  reason?: string;
  /** Read through a fallback (launch fix 24): a browser render, or the
   *  Internet Archive's latest copy because the live site refused us. */
  via?: "rendered" | "archived";
}

export interface FetchProvider {
  fetchText(url: string): Promise<string | null>;
  /** @param fallback Retry a refused page through a render service or
   *  the Internet Archive (launch fix 24). */
  fetchPage?(url: string, fallback?: boolean): Promise<FetchedPage>;
}

// Identifies Metis honestly. No "bot" token: small-business hosts (e.g.
// sdsdentistry.com) answer any user agent containing it with a 403, which
// cost the report the one site the user gave it.
const USER_AGENT = "Mozilla/5.0 (compatible; MetisResearch/1.0; +https://metisanalytic.com)";

// Interstitials hosts serve instead of the page (SiteGround's "One moment,
// please...", Cloudflare's "Just a moment...").
const BOT_CHECK = /<title>\s*(one moment, please|just a moment|attention required|security check|access denied)|sgcaptcha|cf-chl-|challenge-platform/i;

// Domains that block scrapers or return useless content — skip fetching these
const UNFETCHABLE_DOMAINS = new Set([
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "tiktok.com", "reddit.com", "youtube.com", "pinterest.com",
  "wsj.com", "ft.com", "nytimes.com", "bloomberg.com", // paywalled
  "glassdoor.com", "indeed.com", "ziprecruiter.com",
]);

function isUnfetchable(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return UNFETCHABLE_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

export class DirectFetchProvider implements FetchProvider {
  private timeoutMs: number;

  constructor(timeoutMs = 6000) {
    this.timeoutMs = timeoutMs;
  }

  async fetchText(url: string): Promise<string | null> {
    return (await this.fetchPage(url)).html;
  }

  /**
   * Launch fix 24: a site that refuses automated requests (Crumbl's 403 and
   * bot checks) isn't down. A page that fails is fetched again through a
   * browser-render service when RENDER_URL_TEMPLATE is set ("{url}" is
   * replaced), then from its latest Internet Archive copy. Only when the
   * caller asks (`fallback`): the company's own site, not every news page.
   * A page that doesn't exist (no such address) isn't retried.
   */
  async fetchPage(url: string, fallback = false): Promise<FetchedPage> {
    const direct = await this.fetchDirect(url);
    if (!fallback || direct.html || direct.reason === "the address doesn't exist" || direct.reason === "the address isn't a web page"
      || isUnfetchable(url) || /^https?:\/\/web\.archive\.org\//.test(url)) return direct;
    const template = process.env.RENDER_URL_TEMPLATE;
    if (template) {
      const rendered = await this.fetchDirect(template.replace("{url}", encodeURIComponent(url)));
      if (rendered.html) return { html: rendered.html, via: "rendered" };
    }
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const archived = await this.fetchDirect(`https://web.archive.org/web/${stamp}id_/${url}`);
    if (archived.html) return { html: archived.html, via: "archived" };
    return direct;
  }

  private async fetchDirect(url: string): Promise<FetchedPage> {
    if (isUnfetchable(url)) return { html: null, reason: "the site doesn't allow automated reading" };
    const cached = pageCache.get(url);
    if (cached !== undefined) return { html: cached };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      if (!res.ok) return { html: null, reason: `the site returned HTTP ${res.status}` };
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return { html: null, reason: "the address isn't a web page" };
      }
      const text = await res.text();
      // A bot check stands in for the page: report it, never read it as the
      // business's text, and don't cache it (round 2, Fix 1).
      if (BOT_CHECK.test(text.slice(0, 4000))) return { html: null, reason: "the site showed a bot check instead of its page" };
      if (text && text.length < 500_000) pageCache.set(url, text);
      return { html: text };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      return {
        html: null,
        reason: aborted ? "the site didn't respond in time"
          : code === "ENOTFOUND" ? "the address doesn't exist"
          : "the site couldn't be reached",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Serper.dev search provider. Returns [] (not throw) when no API key is
 * configured, so agents can treat "no results" and "no provider" the same
 * way and keep working in degraded mode.
 */
export class SerperSearchProvider implements SearchProvider {
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.SERPER_API_KEY;
  }

  async search(query: string, count = 5, tbs?: string): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    const key = `${query}|${count}|${tbs ?? ""}`;
    const cached = searchCache.get(key);
    if (cached) return cached;
    recordSearchCall();
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tbs ? { q: query, num: count, tbs } : { q: query, num: count }),
      });
      if (!res.ok) { console.warn(`[serper] search HTTP ${res.status}`); return []; }
      const data = (await res.json()) as {
        organic?: { title: string; link: string; snippet?: string; date?: string }[];
      };
      const results = (data.organic ?? []).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        date: r.date,
      }));
      if (results.length > 0) searchCache.set(key, results);
      return results;
    } catch {
      return [];
    }
  }

  /** Google News results (Serper /news): dated articles, which the general
   *  index often buries under the company's own pages (launch fix 36). */
  async news(query: string, count = 10): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    const key = `news|${query}|${count}`;
    const cached = searchCache.get(key);
    if (cached) return cached;
    recordSearchCall();
    try {
      const res = await fetch("https://google.serper.dev/news", {
        method: "POST",
        headers: { "X-API-KEY": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: count }),
      });
      if (!res.ok) { console.warn(`[serper] news HTTP ${res.status}`); return []; }
      const data = (await res.json()) as { news?: { title: string; link: string; snippet?: string; date?: string }[] };
      const results = (data.news ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet, date: r.date }));
      if (results.length > 0) searchCache.set(key, results);
      return results;
    } catch (err) {
      console.warn(`[serper] news failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** Google Maps-style business listings (Serper /places): name, street
   *  address and website, used to list same-named businesses (Fix 1). */
  async places(query: string): Promise<PlaceResult[]> {
    if (!this.apiKey) return [];
    const cached = placesCache.get(query);
    if (cached) return cached;
    recordSearchCall();
    try {
      const res = await fetch("https://google.serper.dev/places", {
        method: "POST",
        headers: { "X-API-KEY": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      if (!res.ok) { console.warn(`[serper] places HTTP ${res.status}`); return []; }
      const data = (await res.json()) as { places?: { title?: string; address?: string; website?: string }[] };
      const results = (data.places ?? [])
        .filter((p): p is { title: string; address?: string; website?: string } => Boolean(p.title))
        .map((p) => ({ title: p.title, address: p.address, website: p.website }));
      if (results.length > 0) placesCache.set(query, results);
      return results;
    } catch {
      return [];
    }
  }
}

/**
 * Strips HTML to readable article text.
 * Aggressively removes nav, header, footer, scripts, ads, cookie banners,
 * and other non-content noise that bleeds into LLM context and degrades output.
 */
export function htmlToText(html: string): string {
  return html
    // Remove entire non-content blocks
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // Remove inline noise elements
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    // Remove cookie/GDPR boilerplate patterns
    .replace(/we use cookies[\s\S]{0,200}(accept|agree|ok)/gi, " ")
    .replace(/subscribe to (our )?newsletter[\s\S]{0,200}/gi, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * All visible text, header and footer included. A small business's address
 * and phone usually sit in the footer, which htmlToText drops: use this
 * when checking where a business is, not for text the LLM summarizes.
 */
export function htmlToFullText(html: string): string {
  return html
    // An inline tag inside a word ("Cantileve<span>r</span>") or before a
    // trademark mark joins, not splits (launch fix 32).
    .replace(/([a-z])<\/?(?:span|sup|sub|b|strong|i|em|small|mark|u|font)\b[^>]*>(?=[a-z®™©]|<\/?(?:span|sup|sub|b|strong|i|em|small|mark|u|font)\b)/g, "$1")
    .replace(/<\/?(?:sup|span)\b[^>]*>\s*([®™©])\s*<\/(?:sup|span)>/gi, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;/g, "-")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the most content-dense portion of a page's text.
 * Splits into chunks and returns the chunk with the most sentence-like content.
 * Helps when htmlToText still returns a lot of nav/menu noise at the start.
 */
export function extractBestChunk(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;

  // Split into ~500 char chunks and score by sentence density
  const chunkSize = 500;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  // Score: count sentence-ending punctuation + presence of numbers/dates
  const scored = chunks.map((chunk, i) => ({
    chunk,
    index: i,
    score: (chunk.match(/[.!?]/g)?.length ?? 0) * 2 +
           (chunk.match(/\d{4}/g)?.length ?? 0) + // years
           (chunk.match(/\$[\d,]+/g)?.length ?? 0) * 3, // dollar amounts
  }));

  // Find the best-scoring window of ~8 chunks
  const windowSize = 8;
  let bestScore = 0;
  let bestStart = 0;
  for (let i = 0; i <= scored.length - windowSize; i++) {
    const windowScore = scored.slice(i, i + windowSize).reduce((s, c) => s + c.score, 0);
    if (windowScore > bestScore) {
      bestScore = windowScore;
      bestStart = i;
    }
  }

  return chunks.slice(bestStart, bestStart + windowSize).join(" ").slice(0, maxChars);
}

// Below this many characters, treat extracted text as "no usable content"
const MIN_USEFUL_TEXT_LENGTH = 120;

/**
 * Fetches a URL and returns clean article text, or null if the page
 * is unfetchable, paywalled, or returns too little content.
 * This is the main entry point for full page fetching in agents.
 */
export async function fetchPageText(
  url: string,
  fetcher: FetchProvider,
  maxChars = 4000
): Promise<string | null> {
  const html = await fetcher.fetchText(url);
  if (!html) return null;
  const text = htmlToText(html);
  if (text.length < MIN_USEFUL_TEXT_LENGTH) return null;
  return extractBestChunk(text, maxChars);
}

export interface ResolvedPage {
  url: string;
  text: string;
  /** true if `text` came from search-result snippets rather than a real
   * page fetch (used when the page itself was too thin, e.g. JS-rendered). */
  fromSnippets: boolean;
}

/**
 * Resolution helper implementing the "mix, with search as fallback"
 * sourcing strategy: try a direct URL guess first, then search, then
 * (if every fetched page is too thin to be useful — common for
 * JS-rendered sites) fall back to stitched-together search snippets so
 * there's still something to show instead of "no data found".
 */
export async function resolveAndFetch(
  directUrl: string | undefined,
  searchQuery: string,
  fetcher: FetchProvider,
  searcher: SearchProvider
): Promise<ResolvedPage | null> {
  let directClean = "";
  if (directUrl) {
    const text = await fetcher.fetchText(directUrl);
    directClean = text ? htmlToText(text) : "";
    if (directClean.length >= MIN_USEFUL_TEXT_LENGTH) {
      return { url: directUrl, text: directClean, fromSnippets: false };
    }
  }

  const results = await searcher.search(searchQuery, 3);
  for (const r of results) {
    const text = await fetcher.fetchText(r.url);
    const clean = text ? htmlToText(text) : "";
    if (clean.length >= MIN_USEFUL_TEXT_LENGTH) {
      return { url: r.url, text: clean, fromSnippets: false };
    }
  }

  // Last resort: stitch search snippets together. Worse than real page
  // text, but better than an empty report, and it costs nothing extra
  // since we already have the search results in hand.
  if (results.length > 0) {
    const stitched = results
      .map((r) => r.snippet)
      .filter(Boolean)
      .join(" ");
    if (stitched.length > 0) {
      return { url: results[0].url, text: stitched, fromSnippets: true };
    }
  }

  // Final fallback: even the direct fetch's thin text is better than nothing.
  if (directClean.length > 0) {
    return { url: directUrl as string, text: directClean, fromSnippets: false };
  }

  return null;
}
