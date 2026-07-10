/**
 * TikTok Creator Intelligence Agent
 * Jackal Protocol — Sprint 1
 *
 * Flow:
 * 1. For each keyword, fetch videos from the hashtag feed
 * 2. Deduplicate creators across all keywords
 * 3. Fetch follower count for each unique creator
 * 4. Score and rank by engagement × follower fit × posting consistency
 * 5. Flag paid disclosures
 * 6. Write snapshot rows to Supabase `creators` table
 *
 * Usage:
 *   ts-node src/agents/creator-agent/index.ts
 *   or call runCreatorAgent() from agent-server.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ── Config ────────────────────────────────────────────────────────────────────

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY!;
const RAPIDAPI_HOST = "tiktok-scraper7.p.rapidapi.com";

// Hashtag IDs — pre-resolved to avoid an extra API call per keyword
// To add a keyword: call GET /challenge/info?challenge_name=<keyword>
const HASHTAG_MAP: Record<string, string> = {
  "glp1":         "34338758",
  "semaglutide":  "1692071432704006",  // resolve if needed
  "tirzepatide":  "1703765327025157",  // resolve if needed
  "bcp157":     "7087977666284322821",  // resolve if needed
  "weightloss":   "41472",
};

// Follower range we care about (moneyball sweet spot: rising, not yet massive)
const MIN_FOLLOWERS = 5_000;
const MAX_FOLLOWERS = 500_000;

// Minimum posts in feed to consider a creator active
const MIN_POSTS_IN_FEED = 2;

// Disclosure keywords — plain regex, no LLM call
const DISCLOSURE_REGEX = /#ad\b|#sponsored\b|#paidpartnership\b|paid\s+partnership|sponsored\s+by|gifted\s+by/i;

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoResult {
  video_id:      string;
  title:         string;
  play_count:    number;
  digg_count:    number;
  comment_count: number;
  share_count:   number;
  create_time:   number;
  region:        string;
  has_disclosure: boolean;
  author: {
    id:        string;
    unique_id: string;
    nickname:  string;
  };
}

interface CreatorProfile {
  tiktok_id:     string;
  handle:        string;
  nickname:      string;
  follower_count: number;
  following_count: number;
  video_count:   number;
  heart_count:   number;
}

interface CreatorSnapshot {
  handle:                  string;
  nickname:                string;
  platform:                string;
  follower_count:          number;
  video_count:             number;
  posts_in_feed:           number;
  avg_play_count:          number;
  avg_engagement_rate:     number;
  posting_frequency_30d:   number;
  disclosure_flag:         boolean;
  disclosure_count:        number;
  category:                string;
  keywords:                string[];
  score:                   number;
  snapshot_date:           string;
  raw_json:                object;
}

// ── RapidAPI Helpers ──────────────────────────────────────────────────────────

async function fetchHashtagVideos(challengeId: string, count = 30): Promise<VideoResult[]> {
  const url = `https://${RAPIDAPI_HOST}/challenge/videos?challenge_id=${challengeId}&count=${count}&cursor=0`;
  const res = await fetch(url, {
    headers: {
      "x-rapidapi-key":  RAPIDAPI_KEY,
      "x-rapidapi-host": RAPIDAPI_HOST,
      "Content-Type":    "application/json",
    },
  });

  if (!res.ok) throw new Error(`Hashtag fetch failed: ${res.status}`);
  // RapidAPI's response shape isn't modeled with a type — cast once here
  // rather than scattering `as any` across every property access below.
  const data = (await res.json()) as any;

  if (data.code !== 0 || !data.data?.videos) {
    console.warn(`[creator-agent] No videos for challenge ${challengeId}`);
    return [];
  }

  return data.data.videos.map((v: any): VideoResult => ({
    video_id:       v.video_id,
    title:          v.title ?? "",
    play_count:     v.play_count ?? 0,
    digg_count:     v.digg_count ?? 0,
    comment_count:  v.comment_count ?? 0,
    share_count:    v.share_count ?? 0,
    create_time:    v.create_time ?? 0,
    region:         v.region ?? "",
    has_disclosure: DISCLOSURE_REGEX.test(v.title ?? ""),
    author: {
      id:        v.author?.id ?? "",
      unique_id: v.author?.unique_id ?? "",
      nickname:  v.author?.nickname ?? "",
    },
  }));
}

async function fetchUserProfile(username: string): Promise<CreatorProfile | null> {
  const url = `https://${RAPIDAPI_HOST}/user/info?unique_id=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: {
      "x-rapidapi-key":  RAPIDAPI_KEY,
      "x-rapidapi-host": RAPIDAPI_HOST,
      "Content-Type":    "application/json",
    },
  });

  if (!res.ok) return null;
  const data = (await res.json()) as any;
  if (data.code !== 0 || !data.data?.user) return null;

  const u = data.data.user;
  const s = data.data.stats;

  return {
    tiktok_id:      u.id ?? "",
    handle:         u.unique_id ?? username,
    nickname:       u.nickname ?? "",
    follower_count: s?.followerCount ?? 0,
    following_count: s?.followingCount ?? 0,
    video_count:    s?.videoCount ?? 0,
    heart_count:    s?.heartCount ?? 0,
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Moneyball score — higher is better rising creator signal.
 *
 * Components:
 * - Engagement rate: (likes + comments + shares) / plays
 * - Follower range fit: penalize below min or above max
 * - Posting activity: posts seen in feed (proxy for consistency)
 */
function scoreCreator(
  profile: CreatorProfile,
  videos: VideoResult[],
): number {
  if (videos.length === 0) return 0;

  // Engagement rate across their videos in this niche
  const totalPlays    = videos.reduce((s, v) => s + v.play_count, 0);
  const totalEngagement = videos.reduce(
    (s, v) => s + v.digg_count + v.comment_count + v.share_count, 0
  );
  const engagementRate = totalPlays > 0 ? totalEngagement / totalPlays : 0;

  // Follower range fit (0-1): peaks at sweet spot, drops outside
  const fc = profile.follower_count;
  let followerFit = 0;
  if (fc >= MIN_FOLLOWERS && fc <= MAX_FOLLOWERS) {
    // Linear ramp up to 50k, flat 50k-200k, ramp down to 500k
    if (fc < 50_000)       followerFit = (fc - MIN_FOLLOWERS) / (50_000 - MIN_FOLLOWERS);
    else if (fc <= 200_000) followerFit = 1.0;
    else                   followerFit = 1 - (fc - 200_000) / (MAX_FOLLOWERS - 200_000);
  }

  // Posting activity score (0-1) based on posts seen in niche feed
  const activityScore = Math.min(videos.length / 5, 1);

  // Weighted composite
  const score = (engagementRate * 0.5) + (followerFit * 0.35) + (activityScore * 0.15);
  return Math.round(score * 10000) / 10000; // 4 decimal places
}

// ── Main Agent ────────────────────────────────────────────────────────────────

export async function runCreatorAgent(
  keywords: string[] = Object.keys(HASHTAG_MAP),
  category = "health/glp1",
): Promise<CreatorSnapshot[]> {
  console.log(`[creator-agent] Starting scan for: ${keywords.join(", ")}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Step 1: Collect all videos across keywords
  const creatorVideos = new Map<string, { videos: VideoResult[]; keywords: Set<string> }>();

  for (const keyword of keywords) {
    const challengeId = HASHTAG_MAP[keyword];
    if (!challengeId) {
      console.warn(`[creator-agent] No challenge ID for keyword: ${keyword}`);
      continue;
    }

    console.log(`[creator-agent] Fetching videos for #${keyword} (id: ${challengeId})`);
    const videos = await fetchHashtagVideos(challengeId, 30);
    console.log(`[creator-agent] Got ${videos.length} videos for #${keyword}`);

    // US filter only
    const usVideos = videos.filter(v => v.region === "US" || v.region === "");

    for (const video of usVideos) {
      const handle = video.author.unique_id;
      if (!handle) continue;

      if (!creatorVideos.has(handle)) {
        creatorVideos.set(handle, { videos: [], keywords: new Set() });
      }
      creatorVideos.get(handle)!.videos.push(video);
      creatorVideos.get(handle)!.keywords.add(keyword);
    }

    // Rate limit — avoid hammering the API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[creator-agent] Found ${creatorVideos.size} unique creators`);

  // Step 2: Filter to creators with minimum activity
  const activeCreators = [...creatorVideos.entries()].filter(
    ([, { videos }]) => videos.length >= MIN_POSTS_IN_FEED
  );

  console.log(`[creator-agent] ${activeCreators.length} creators with ${MIN_POSTS_IN_FEED}+ posts`);

  // Step 3: Fetch profiles and score
  const snapshots: CreatorSnapshot[] = [];

  for (const [handle, { videos, keywords: kws }] of activeCreators) {
    console.log(`[creator-agent] Fetching profile for @${handle}`);
    const profile = await fetchUserProfile(handle);

    if (!profile) {
      console.warn(`[creator-agent] Could not fetch profile for @${handle}`);
      continue;
    }

    // Follower range filter
    if (profile.follower_count < MIN_FOLLOWERS || profile.follower_count > MAX_FOLLOWERS) {
      console.log(`[creator-agent] Skipping @${handle} — ${profile.follower_count} followers (out of range)`);
      continue;
    }

    const avgPlays = videos.reduce((s, v) => s + v.play_count, 0) / videos.length;
    const totalEngagement = videos.reduce(
      (s, v) => s + v.digg_count + v.comment_count + v.share_count, 0
    );
    const avgEngagementRate = avgPlays > 0 ? totalEngagement / videos.length / avgPlays : 0;

    // Posting frequency: posts in last 30 days
    const thirtyDaysAgo = Date.now() / 1000 - 30 * 86400;
    const recentPosts = videos.filter(v => v.create_time >= thirtyDaysAgo).length;

    const disclosureCount = videos.filter(v => v.has_disclosure).length;
    const score = scoreCreator(profile, videos);

    const snapshot: CreatorSnapshot = {
      handle:                  profile.handle,
      nickname:                profile.nickname,
      platform:                "tiktok",
      follower_count:          profile.follower_count,
      video_count:             profile.video_count,
      posts_in_feed:           videos.length,
      avg_play_count:          Math.round(avgPlays),
      avg_engagement_rate:     Math.round(avgEngagementRate * 10000) / 10000,
      posting_frequency_30d:   recentPosts,
      disclosure_flag:         disclosureCount > 0,
      disclosure_count:        disclosureCount,
      category,
      keywords:                [...kws],
      score,
      snapshot_date:           new Date().toISOString(),
      raw_json: { profile, videos },
    };

    snapshots.push(snapshot);

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Step 4: Sort by score descending
  snapshots.sort((a, b) => b.score - a.score);

  console.log(`[creator-agent] ${snapshots.length} creators scored and ranked`);

  // Step 5: Write to Supabase
  if (snapshots.length > 0) {
    const rows = snapshots.map(s => ({
      name:                    s.nickname,
      platform:                s.platform,
      handle:                  s.handle,
      follower_count:          s.follower_count,
      engagement_rate:         s.avg_engagement_rate,
      posting_frequency_30d:   s.posting_frequency_30d,
      disclosure_flag:         s.disclosure_flag,
      category:                s.category,
      snapshot_date:           s.snapshot_date,
      raw_json:                s.raw_json,
    }));

    const { error } = await supabase.from("creators").insert(rows);
    if (error) {
      console.error("[creator-agent] Supabase write failed:", error.message);
    } else {
      console.log(`[creator-agent] Wrote ${rows.length} rows to creators table`);
    }
  }

  // Step 6: Print ranking to console
  console.log("\n── CREATOR RANKING ──────────────────────────────────────");
  console.log("Rank  Handle                  Followers  EngRate  Score   Disclosed  Keywords");
  snapshots.slice(0, 20).forEach((s, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${s.handle.padEnd(22)}  ${String(s.follower_count).padStart(9)}  ${String(s.avg_engagement_rate.toFixed(4)).padStart(7)}  ${s.score.toFixed(4)}  ${s.disclosure_flag ? "YES" : "no "}        ${s.keywords.join(", ")}`
    );
  });

  return snapshots;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runCreatorAgent()
    .then(results => {
      console.log(`\n[creator-agent] Done. ${results.length} creators in output.`);
      process.exit(0);
    })
    .catch(err => {
      console.error("[creator-agent] Fatal error:", err);
      process.exit(1);
    });
}
