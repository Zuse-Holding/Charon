/**
 * Creator Snapshot Agent
 *
 * Daily tracker for creators a user has explicitly put on their
 * watchlist (watchlist.type = 'creator') — distinct from
 * src/agents/creator-agent, which is a one-off GLP-1 hashtag discovery
 * scanner. This agent:
 *
 * 1. Reads the tracked-creator list from the Supabase `watchlist` table
 * 2. Pulls current TikTok profile + recent-post stats per creator
 * 3. Computes a bot/authenticity score for that snapshot (no history
 *    needed — see src/lib/bot-score.ts)
 * 4. Writes one row/day per creator to `creator_snapshots`, upserted on
 *    (creator_id, platform, snapshot_date) so re-running the same day
 *    never duplicates rows
 * 5. Once a creator has enough history, recomputes their growth
 *    trajectory (src/lib/trajectory-score.ts) and denormalizes the
 *    result onto their watchlist row for ranking
 *
 * creator_id in creator_snapshots points at watchlist.id, not a
 * separate creators-registry id — see supabase/schema.sql for why.
 *
 * Usage:
 *   tsx src/agents/creator-snapshot-agent/index.ts
 *   or call runCreatorSnapshotAgent() from a scheduled job
 *
 * No `dotenv/config` import here deliberately — this module is also
 * imported directly into the Next.js app (web/app/api/creator-snapshot)
 * via the @src/* path alias, where env vars are already loaded by Next
 * itself and `dotenv` isn't a dependency of web/'s own package.json.
 * CLI callers (run-creator-snapshot.mjs) load dotenv themselves before
 * calling in.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchTikTokProfile, fetchTikTokRecentPosts, normalizeHandle, resolveTikTokHandle } from "../../lib/tiktok.js";
import { computeBotScore } from "../../lib/bot-score.js";
import { computeTrajectoryScore, SnapshotPoint } from "../../lib/trajectory-score.js";
import { SerperSearchProvider } from "../../lib/providers.js";

const PLATFORM = "tiktok";
const RECENT_POST_COUNT = 10;
const DELAY_BETWEEN_CREATORS_MS = 400;

interface WatchlistCreator {
  id: string;
  subject: string;
}

interface SnapshotOutcome {
  watchlistId: string;
  handle: string;
  status: "written" | "skipped" | "failed";
  reason?: string;
  followerCount?: number;
  botScore?: number;
  trajectoryLabel?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeAvgEngagementRate(posts: { playCount: number; diggCount: number; commentCount: number }[]): number | null {
  if (posts.length === 0) return null;
  const totalPlays = posts.reduce((s, p) => s + p.playCount, 0);
  if (totalPlays === 0) return null;
  const totalEngagement = posts.reduce((s, p) => s + p.diggCount + p.commentCount, 0);
  return Math.round((totalEngagement / totalPlays) * 10000) / 10000;
}

// watchlistIds: when omitted, processes every tracked creator across all
// users (the cron/CLI case). Pass a specific set of watchlist ids to
// scope a run to one user's own creators — e.g. a "run now" button on
// their Watchlist page shouldn't also burn RapidAPI quota re-snapshotting
// every other user's tracked creators.
export async function runCreatorSnapshotAgent(watchlistIds?: string[]): Promise<SnapshotOutcome[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let query = supabase.from("watchlist").select("id, subject").eq("type", "creator");
  if (watchlistIds) query = query.in("id", watchlistIds);
  const { data: tracked, error: watchlistError } = await query.returns<WatchlistCreator[]>();

  if (watchlistError) {
    throw new Error(`[creator-snapshot-agent] Failed to load watchlist: ${watchlistError.message}`);
  }
  if (!tracked || tracked.length === 0) {
    console.log("[creator-snapshot-agent] No creators on the watchlist — nothing to do.");
    return [];
  }

  console.log(`[creator-snapshot-agent] Tracking ${tracked.length} creator(s)`);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outcomes: SnapshotOutcome[] = [];
  const searcher = new SerperSearchProvider();

  for (const entry of tracked) {
    let handle = normalizeHandle(entry.subject);
    try {
      let profile = await fetchTikTokProfile(handle);

      // A watchlist subject isn't always a real handle — added via the
      // "Watch" button on a real-name search result, or promoted from a
      // discovery candidate that was a name rather than a handle ("Mr
      // Beast"), fetchTikTokProfile can never resolve it since RapidAPI
      // needs the actual unique_id. Try resolving it via search once
      // (skip entirely if the subject already looks like a handle — no
      // point re-searching a handle that's simply wrong/deleted), and
      // persist the resolved handle back onto the row so this only costs
      // a search on the first run, not every run.
      if (!profile && !entry.subject.trim().startsWith("@")) {
        const resolved = await resolveTikTokHandle(entry.subject, searcher);
        if (resolved) {
          const resolvedProfile = await fetchTikTokProfile(resolved);
          if (resolvedProfile) {
            profile = resolvedProfile;
            handle = resolved;
            const { error: subjectUpdateError } = await supabase
              .from("watchlist")
              .update({ subject: `@${resolved}` })
              .eq("id", entry.id);
            if (subjectUpdateError) {
              console.warn(`[creator-snapshot-agent] Resolved @${resolved} for "${entry.subject}" but failed to persist it: ${subjectUpdateError.message}`);
            } else {
              console.log(`[creator-snapshot-agent] Resolved "${entry.subject}" -> @${resolved}`);
            }
          }
        }
      }

      if (!profile) {
        console.warn(`[creator-snapshot-agent] Skipping ${entry.subject} — no TikTok profile found for @${handle}`);
        outcomes.push({ watchlistId: entry.id, handle, status: "skipped", reason: "profile_not_found" });
        continue;
      }

      const recentPosts = await fetchTikTokRecentPosts(handle, RECENT_POST_COUNT);
      const { score: botScore, flags: botScoreFlags } = computeBotScore({
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        postCount: profile.videoCount,
        bio: profile.bio,
        hasAvatar: !!profile.avatarUrl,
        verified: profile.verified,
        recentPostTimestamps: recentPosts.map((p) => p.createTime),
      });

      const row = {
        creator_id: entry.id,
        platform: PLATFORM,
        snapshot_date: today,
        follower_count: profile.followerCount,
        following_count: profile.followingCount,
        post_count: profile.videoCount,
        total_likes: profile.heartCount,
        avg_engagement_rate: computeAvgEngagementRate(recentPosts),
        bio_complete: profile.bio.trim().length > 0 && !!profile.avatarUrl,
        bot_score: botScore,
        bot_score_flags: botScoreFlags,
        raw_payload: { profile, recentPosts },
      };

      const { error: upsertError } = await supabase
        .from("creator_snapshots")
        .upsert(row, { onConflict: "creator_id,platform,snapshot_date" });

      if (upsertError) {
        console.error(`[creator-snapshot-agent] Write failed for @${handle}:`, upsertError.message);
        outcomes.push({ watchlistId: entry.id, handle, status: "failed", reason: upsertError.message });
        continue;
      }

      console.log(
        `[creator-snapshot-agent] @${handle} — ${profile.followerCount} followers, bot_score=${botScore}${botScoreFlags.length ? ` (${botScoreFlags.join(", ")})` : ""}`
      );

      const trajectoryLabel = await updateTrajectoryScore(supabase, entry.id);
      outcomes.push({
        watchlistId: entry.id,
        handle,
        status: "written",
        followerCount: profile.followerCount,
        botScore,
        trajectoryLabel,
      });
    } catch (err) {
      console.error(`[creator-snapshot-agent] Unexpected error for ${entry.subject}:`, err instanceof Error ? err.message : err);
      outcomes.push({ watchlistId: entry.id, handle, status: "failed", reason: err instanceof Error ? err.message : String(err) });
    }

    await sleep(DELAY_BETWEEN_CREATORS_MS);
  }

  const written = outcomes.filter((o) => o.status === "written").length;
  console.log(`[creator-snapshot-agent] Done — ${written}/${tracked.length} snapshot(s) written.`);
  return outcomes;
}

// Recomputes the growth trajectory from full snapshot history and
// denormalizes it onto the watchlist row (see src/lib/trajectory-score.ts
// for why this needs a history, unlike the bot score above). Returns the
// resulting label for logging; failures here are non-fatal to the
// snapshot write that already succeeded.
async function updateTrajectoryScore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  watchlistId: string
): Promise<string | undefined> {
  const { data: history, error } = await supabase
    .from("creator_snapshots")
    .select("snapshot_date, follower_count, bot_score")
    .eq("creator_id", watchlistId)
    .eq("platform", PLATFORM)
    .order("snapshot_date", { ascending: true })
    .returns<{ snapshot_date: string; follower_count: number | null; bot_score: number | null }[]>();

  if (error || !history) {
    console.warn(`[creator-snapshot-agent] Could not load history for trajectory score (${watchlistId}):`, error?.message);
    return undefined;
  }

  const points: SnapshotPoint[] = history
    .filter((h) => h.follower_count != null)
    .map((h) => ({
      snapshotDate: h.snapshot_date,
      followerCount: h.follower_count as number,
      botScore: h.bot_score ?? 50,
    }));

  const { trajectoryScore, label } = computeTrajectoryScore(points);
  if (label === "insufficient_data") return label;

  const { error: updateError } = await supabase
    .from("watchlist")
    .update({ trajectory_score: trajectoryScore, trajectory_label: label })
    .eq("id", watchlistId);

  if (updateError) {
    console.warn(`[creator-snapshot-agent] Could not update trajectory score for ${watchlistId}:`, updateError.message);
  }

  return label;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runCreatorSnapshotAgent()
    .then((outcomes) => {
      console.log(`\n[creator-snapshot-agent] Finished. ${outcomes.length} creator(s) processed.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[creator-snapshot-agent] Fatal error:", err);
      process.exit(1);
    });
}
