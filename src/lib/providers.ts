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

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface SearchProvider {
  search(query: string, count?: number): Promise<SearchResult[]>;
}

export interface FetchProvider {
  fetchText(url: string): Promise<string | null>;
}

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
    if (isUnfetchable(url)) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CharonResearchBot/1.0; +https://charon.zuseholdings.com)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
      return await res.text();
    } catch {
      return null;
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

  async search(query: string, count = 5): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: count }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        organic?: { title: string; link: string; snippet?: string }[];
      };
      return (data.organic ?? []).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
      }));
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
