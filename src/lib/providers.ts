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

export class DirectFetchProvider implements FetchProvider {
  async fetchText(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "SelineIntelBot/0.1 (+research agent)" },
      });
      if (!res.ok) return null;
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

/** Strips HTML tags down to readable text. Good enough for Sprint 1; a
 * real readability extractor (e.g. @mozilla/readability) is a Sprint 2
 * upgrade candidate. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Below this many characters, treat extracted text as "no usable content"
// rather than success. JS-rendered sites return a 200 with almost no
// static text in the HTML — without this check, that thin/blank text
// would get reported as a real description.
const MIN_USEFUL_TEXT_LENGTH = 120;

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
