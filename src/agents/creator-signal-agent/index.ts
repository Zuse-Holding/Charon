import {
  CreatorAgentResult,
  CreatorProfile,
  CreatorSignalEntry,
  ShortFormMention,
  Source,
  TrendPoint,
  TrendSummary,
  YoutubeChannelStats,
} from "../../types/research.js";
import { FetchProvider, SearchProvider, fetchPageText } from "../../lib/providers.js";
import { CreatorExtractionSchema, extractStructured } from "../../lib/llm.js";

/**
 * Creator / Market-Signal Intelligence Agent (general v1)
 *
 * General, multi-industry version of the bespoke tool in
 * src/agents/creator-agent — that one is hardcoded to GLP-1/weight-loss
 * TikTok hashtags and pulls follower counts from a paid, unofficial
 * RapidAPI scraper (real ToS exposure). This agent answers a different,
 * broader question — "who is this creator/account, is their reach
 * rising or falling, and what are people saying about them" — for any
 * name, any niche, not one client vertical. See
 * docs/next-verticals-scoping.md for the scoping decision behind this.
 *
 * Sourcing, same "mostly search-synthesis" model as political-agent:
 *   - Bio/niche/platform and "what people are saying" (chatter,
 *     controversy, sponsorship reception): search-and-synthesize via
 *     SearchProvider + extractStructured, full page text fetched for the
 *     top results per section (not just snippets).
 *   - Subscriber/view counts: YouTube Data API (YOUTUBE_API_KEY) — the
 *     one free, official, structured source available here. Silently
 *     skipped if the creator has no YouTube presence or the key isn't set.
 *   - Rising/falling interest: Google Trends' undocumented widget JSON
 *     endpoint (no official public API exists). Best-effort only — same
 *     fail-soft contract as every other agent here: any shape mismatch
 *     or request failure just means an absent `trend` field, never a
 *     thrown error.
 *
 * TikTok/Instagram follower/account stats are deliberately NOT
 * attempted — no reliable free API exists for an arbitrary account on
 * either platform (see the scoping doc; the real option there is a paid
 * influencer-discovery platform like Modash/HypeAuditor, revisit post-
 * funding). Instead, `shortFormMentions` does a targeted site:-scoped
 * search against tiktok.com/instagram.com, filtered to the last month
 * for freshness, and returns the raw hits as direct links — deliberately
 * NOT run through the LLM synthesis step. A link straight to the actual
 * post is sharper, free evidence of "this is happening right now" than
 * a paraphrase would be, and it costs nothing beyond the existing Serper
 * search quota. Recent News is not gathered here; the orchestrator runs
 * the existing NewsAgent alongside this agent instead of duplicating
 * that logic.
 */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3";

interface YoutubeSearchResponse {
  items?: { id?: { channelId?: string }; snippet?: { channelId?: string } }[];
}

interface YoutubeChannelsResponse {
  items?: {
    snippet?: { title?: string; publishedAt?: string };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }[];
}

async function fetchYoutubeChannelStats(name: string): Promise<YoutubeChannelStats | null> {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const searchRes = await fetch(
      `${YOUTUBE_BASE}/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(name)}&key=${YOUTUBE_API_KEY}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!searchRes.ok) {
      console.warn(`[creator-signal-agent] YouTube search HTTP ${searchRes.status} for "${name}"`);
      return null;
    }
    const searchData = (await searchRes.json()) as YoutubeSearchResponse;
    const channelId = searchData.items?.[0]?.id?.channelId ?? searchData.items?.[0]?.snippet?.channelId;
    if (!channelId) return null;

    const statsRes = await fetch(
      `${YOUTUBE_BASE}/channels?part=snippet,statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!statsRes.ok) {
      console.warn(`[creator-signal-agent] YouTube channels HTTP ${statsRes.status} for "${name}"`);
      return null;
    }
    const statsData = (await statsRes.json()) as YoutubeChannelsResponse;
    const item = statsData.items?.[0];
    if (!item) return null;

    return {
      channelId,
      channelTitle: item.snippet?.title ?? name,
      subscriberCount: item.statistics?.hiddenSubscriberCount ? undefined : item.statistics?.subscriberCount,
      viewCount: item.statistics?.viewCount,
      videoCount: item.statistics?.videoCount,
      publishedAt: item.snippet?.publishedAt,
      url: `https://www.youtube.com/channel/${channelId}`,
    };
  } catch (err) {
    console.warn(`[creator-signal-agent] YouTube lookup failed for "${name}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

// --- Google Trends (undocumented widget JSON API — no key, no official
// support). Every response is prefixed with ")]}',\n" as an XSSI guard,
// which has to be stripped before JSON.parse. Two round trips: explore
// (resolves a per-request token) then widgetdata/multiline (the actual
// timeseries). Wrapped end-to-end in try/catch — this endpoint isn't
// documented or contractually stable, so any shape change just means no
// trend data rather than a broken research run.
const TRENDS_BASE = "https://trends.google.com/trends/api";
const XSSI_PREFIX = /^\)\]\}',?\n?/;

interface TrendsExploreResponse {
  widgets?: { id: string; token: string; request: unknown }[];
}

interface TrendsTimelineResponse {
  default?: { timelineData?: { time: string; value?: number[] }[] };
}

async function fetchTrendPoints(keyword: string): Promise<TrendPoint[]> {
  try {
    const exploreReq = {
      comparisonItem: [{ keyword, geo: "US", time: "today 3-m" }],
      category: 0,
      property: "",
    };
    const exploreRes = await fetch(
      `${TRENDS_BASE}/explore?hl=en-US&tz=300&req=${encodeURIComponent(JSON.stringify(exploreReq))}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!exploreRes.ok) return [];
    const exploreText = (await exploreRes.text()).replace(XSSI_PREFIX, "");
    const exploreData = JSON.parse(exploreText) as TrendsExploreResponse;
    const widget = exploreData.widgets?.find((w) => w.id === "TIMESERIES");
    if (!widget) return [];

    const dataRes = await fetch(
      `${TRENDS_BASE}/widgetdata/multiline?hl=en-US&tz=300&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${widget.token}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!dataRes.ok) return [];
    const dataText = (await dataRes.text()).replace(XSSI_PREFIX, "");
    const timelineData = (JSON.parse(dataText) as TrendsTimelineResponse).default?.timelineData ?? [];

    return timelineData
      .map((t) => ({
        date: new Date(Number(t.time) * 1000).toISOString().slice(0, 10),
        interest: t.value?.[0] ?? 0,
      }))
      .filter((p) => !isNaN(new Date(p.date).getTime()));
  } catch (err) {
    console.warn(`[creator-signal-agent] Google Trends lookup failed for "${keyword}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

function summarizeTrend(keyword: string, points: TrendPoint[]): TrendSummary | undefined {
  if (points.length < 2) return undefined;

  const mid = Math.floor(points.length / 2);
  const firstHalfAvg = points.slice(0, mid).reduce((s, p) => s + p.interest, 0) / mid;
  const secondHalfAvg = points.slice(mid).reduce((s, p) => s + p.interest, 0) / (points.length - mid);
  const delta = secondHalfAvg - firstHalfAvg;

  const direction: TrendSummary["direction"] = delta > 5 ? "rising" : delta < -5 ? "falling" : "flat";
  const averageInterest = Math.round(points.reduce((s, p) => s + p.interest, 0) / points.length);

  return { keyword, points, direction, averageInterest };
}

// --- Short-form mentions (TikTok / Instagram, free option #4 from
// docs/next-verticals-scoping.md) — site:-scoped search against each
// platform via the existing SearchProvider, no scraping and no platform
// API involved. tiktok.com/instagram.com are both in providers.ts's
// UNFETCHABLE_DOMAINS list, so full-page fetch is skipped automatically
// for these — the search snippet is genuinely the best available text,
// not a fallback from a failed fetch. "qdr:m" (past month) trades some
// recall for freshness, since the point is catching current activity,
// not building a historical archive; loosen/tighten if that tradeoff
// needs adjusting later.
async function fetchShortFormMentions(name: string, searcher: SearchProvider): Promise<ShortFormMention[]> {
  const [tiktokResults, instagramResults] = await Promise.all([
    searcher.search(`site:tiktok.com "${name}"`, 5, "qdr:m"),
    searcher.search(`site:instagram.com "${name}"`, 5, "qdr:m"),
  ]);

  const seen = new Set<string>();
  const mentions: ShortFormMention[] = [];
  for (const [platform, results] of [["tiktok", tiktokResults], ["instagram", instagramResults]] as const) {
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      mentions.push({ platform, title: r.title, url: r.url, snippet: r.snippet });
    }
  }
  return mentions;
}

export class CreatorSignalAgent {
  constructor(
    private fetcher: FetchProvider,
    private searcher: SearchProvider
  ) {}

  async run(name: string): Promise<CreatorAgentResult> {
    const queries = [
      `${name} creator influencer bio niche platform followers`,
      `${name} going viral trending growth`,
      `${name} controversy backlash criticism`,
      `${name} sponsorship paid partnership brand deal reaction`,
    ];

    const [bioResults, viralResults, controversyResults, sponsorResults] = await Promise.all(
      queries.map((q) => this.searcher.search(q, 5))
    );

    const sources: Source[] = [];
    const tag = (results: typeof bioResults, usedFor: string) => {
      for (const r of results) {
        sources.push({ url: r.url, title: r.title, retrievedAt: new Date().toISOString(), usedFor: [usedFor] });
      }
    };
    tag(bioResults, "profile");
    tag(viralResults, "signals");
    tag(controversyResults, "signals");
    tag(sponsorResults, "signals");

    const sections: { label: string; results: typeof bioResults }[] = [
      { label: "BIO / NICHE SEARCH", results: bioResults },
      { label: "VIRALITY / GROWTH SEARCH", results: viralResults },
      { label: "CONTROVERSY SEARCH", results: controversyResults },
      { label: "SPONSORSHIP REACTION SEARCH", results: sponsorResults },
    ];

    const sectionTexts = await Promise.all(
      sections.map(async ({ label, results }) => {
        if (results.length === 0) return "";
        const fetched = await Promise.all(
          results.slice(0, 2).map((r) => fetchPageText(r.url, this.fetcher, 2000))
        );
        const fullTextBlock = fetched
          .map((text, i) => (text ? `FULL PAGE (${results[i].url}):\n${text}` : ""))
          .filter(Boolean)
          .join("\n\n");
        const snippetBlock = results
          .filter((_r, i) => i >= 2 || !fetched[i])
          .map((r) => `${r.title}: ${r.snippet ?? ""}`)
          .join("\n");
        return [`${label}:`, fullTextBlock, snippetBlock].filter(Boolean).join("\n");
      })
    );

    const combinedText = sectionTexts.filter(Boolean).join("\n\n");

    const profile: CreatorProfile = { name };
    let signals: CreatorSignalEntry[] = [];

    if (combinedText.length > 0) {
      const llmResult = await extractStructured(
        `You are a market-signal research analyst compiling a factual briefing on the creator/public account "${name}" from search results.

CRITICAL RULES:
- Report facts as found in the source text. Do not editorialize or invent a platform/niche not stated in the text.
- handle: the specific @handle/username, only if explicitly stated. Omit rather than guess.
- platform: the primary platform (YouTube, TikTok, Instagram, X, etc), only if clearly indicated.
- category: their content niche/vertical (e.g. "tech reviews", "GLP-1/weight-loss", "personal finance").
- summary: 1-2 sentences — who they are and what they're known for.
- signals: an array of {topic, finding, sentiment}. Each entry is a specific, sourced finding about what people are currently saying about this creator — growth/virality, controversy, sponsorship/paid-partnership reception, audience sentiment shifts. sentiment is "positive"/"negative"/"neutral"/"mixed". Do NOT invent signals — only include what the source text actually supports. Empty array is fine if nothing substantive is in the source text.
- Every field must be traceable to the provided source text. Do not use outside knowledge to fill gaps.`,
        combinedText,
        CreatorExtractionSchema
      );

      if (llmResult) {
        if (llmResult.handle) profile.handle = llmResult.handle;
        if (llmResult.platform) profile.platform = llmResult.platform;
        if (llmResult.category) profile.category = llmResult.category;
        if (llmResult.summary) profile.summary = llmResult.summary;
        if (llmResult.knownFor) profile.knownFor = llmResult.knownFor;
        signals = llmResult.signals;
      }
    }

    if (!profile.summary && bioResults[0]?.snippet) {
      profile.summary = bioResults[0].snippet;
    }

    const [youtubeStats, trendPoints, shortFormMentions] = await Promise.all([
      fetchYoutubeChannelStats(name),
      fetchTrendPoints(name),
      fetchShortFormMentions(name, this.searcher),
    ]);

    for (const m of shortFormMentions) {
      sources.push({
        url: m.url,
        title: m.title,
        retrievedAt: new Date().toISOString(),
        usedFor: ["short-form-mentions"],
      });
    }

    if (youtubeStats) {
      sources.push({
        url: youtubeStats.url,
        title: `YouTube — ${youtubeStats.channelTitle}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["youtube-stats"],
      });
    }

    const trend = summarizeTrend(name, trendPoints);
    if (trend) {
      sources.push({
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(name)}`,
        title: `Google Trends — ${name}`,
        retrievedAt: new Date().toISOString(),
        usedFor: ["trend"],
      });
    }

    return {
      profile,
      youtubeStats: youtubeStats ?? undefined,
      trend,
      signals,
      shortFormMentions,
      sources,
    };
  }
}
