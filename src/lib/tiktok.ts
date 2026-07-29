// Shared TikTok RapidAPI helpers for creator-tracking agents.
//
// Deliberately separate from src/agents/creator-agent's private fetch
// helpers — that agent is a discovery scanner (hashtag feeds, one-off
// scoring) and is left untouched here. This module backs
// creator-snapshot-agent, which tracks a fixed watchlist of creators
// over time and needs profile + recent-post data on a schedule.
//
// Same fail-soft contract as the rest of the agent layer: a request
// failure or unexpected response shape returns null/[] rather than
// throwing, so one bad lookup doesn't take down a whole snapshot run.

const RAPIDAPI_HOST = "tiktok-scraper7.p.rapidapi.com";

function rapidApiHeaders(): Record<string, string> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY is not set");
  return {
    "x-rapidapi-key": key,
    "x-rapidapi-host": RAPIDAPI_HOST,
    "Content-Type": "application/json",
  };
}

export interface TikTokProfile {
  tiktokId: string;
  handle: string;
  nickname: string;
  bio: string;
  avatarUrl: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  videoCount: number;
  heartCount: number;
}

export async function fetchTikTokProfile(handle: string): Promise<TikTokProfile | null> {
  try {
    const url = `https://${RAPIDAPI_HOST}/user/info?unique_id=${encodeURIComponent(handle)}`;
    const res = await fetch(url, { headers: rapidApiHeaders(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[tiktok] profile fetch HTTP ${res.status} for @${handle}`);
      return null;
    }
    const data = (await res.json()) as any;
    if (data.code !== 0 || !data.data?.user) return null;

    const u = data.data.user;
    const s = data.data.stats;

    return {
      tiktokId: u.id ?? "",
      handle: u.unique_id ?? handle,
      nickname: u.nickname ?? "",
      bio: u.signature ?? "",
      avatarUrl: u.avatarLarger ?? u.avatarMedium ?? u.avatarThumb ?? "",
      verified: !!u.verified,
      followerCount: s?.followerCount ?? 0,
      followingCount: s?.followingCount ?? 0,
      videoCount: s?.videoCount ?? 0,
      heartCount: s?.heartCount ?? 0,
    };
  } catch (err) {
    console.warn(`[tiktok] profile fetch failed for @${handle}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface TikTokPost {
  videoId: string;
  createTime: number; // unix seconds
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
}

export async function fetchTikTokRecentPosts(handle: string, count = 10): Promise<TikTokPost[]> {
  try {
    const url = `https://${RAPIDAPI_HOST}/user/posts?unique_id=${encodeURIComponent(handle)}&count=${count}&cursor=0`;
    const res = await fetch(url, { headers: rapidApiHeaders(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[tiktok] posts fetch HTTP ${res.status} for @${handle}`);
      return [];
    }
    const data = (await res.json()) as any;
    if (data.code !== 0 || !data.data?.videos) return [];

    return data.data.videos.map((v: any): TikTokPost => ({
      videoId: v.video_id ?? "",
      createTime: v.create_time ?? 0,
      playCount: v.play_count ?? 0,
      diggCount: v.digg_count ?? 0,
      commentCount: v.comment_count ?? 0,
      shareCount: v.share_count ?? 0,
    }));
  } catch (err) {
    console.warn(`[tiktok] posts fetch failed for @${handle}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// Watchlist subjects may be typed as "@handle" or a bare handle —
// strip the "@" so it matches RapidAPI's unique_id param either way.
export function normalizeHandle(subject: string): string {
  return subject.trim().replace(/^@/, "");
}
