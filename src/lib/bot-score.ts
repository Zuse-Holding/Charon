// Bot / authenticity score — no history required, works off a single
// profile snapshot. Higher score = more likely authentic/organic.
//
// This is a heuristic scorer, not a classifier trained on labeled data —
// each component below is a known signal cited in influencer-fraud
// literature (follow/follower ratios, follower-to-content mismatch,
// profile completeness, posting-cadence uniformity), combined as simple
// point deductions from a 100 baseline. Flags are returned alongside the
// score so a reviewer can see *why* an account scored low, rather than
// trusting an opaque number.

export interface BotScoreInput {
  followerCount: number;
  followingCount: number;
  postCount: number;
  bio: string;
  hasAvatar: boolean;
  verified: boolean;
  // Unix-seconds timestamps of the creator's most recent posts, any order.
  // Optional — cadence scoring is skipped without enough of them.
  recentPostTimestamps?: number[];
}

export interface BotScoreResult {
  score: number; // 0-100
  flags: string[];
  // Same keys as flags, mapping to the signed point adjustment each
  // signal contributed — lets a reviewer/UI show *why* a score landed
  // where it did, not just the final number.
  breakdown: Record<string, number>;
}

const MIN_TIMESTAMPS_FOR_CADENCE = 4;

export function computeBotScore(input: BotScoreInput): BotScoreResult {
  const { followerCount, followingCount, postCount, bio, hasAvatar, verified, recentPostTimestamps } = input;
  const flags: string[] = [];
  const breakdown: Record<string, number> = {};
  let score = 100;

  const applyDeduction = (flag: string, points: number) => {
    score += points;
    flags.push(flag);
    breakdown[flag] = points;
  };

  // 1. Follow/follower ratio — mass-following is a common bot/farm pattern.
  if (followingCount > 500) {
    const followRatio = followingCount / Math.max(followerCount, 1);
    if (followRatio > 3) {
      applyDeduction("mass_follow_pattern", -25);
    } else if (followRatio > 1) {
      applyDeduction("elevated_following_ratio", -10);
    }
  }

  // 2. High follower count with little content to justify the audience —
  // classic purchased-follower signature.
  if (followerCount >= 50_000 && postCount < 10) {
    applyDeduction("high_followers_low_content", -30);
  } else if (followerCount >= 10_000 && postCount < 5) {
    applyDeduction("high_followers_low_content", -20);
  }

  // 3. Profile completeness.
  if (!bio || bio.trim().length === 0) {
    applyDeduction("empty_bio", -10);
  }
  if (!hasAvatar) {
    applyDeduction("no_avatar", -10);
  }
  if (verified) {
    applyDeduction("verified", 15);
  }

  // 4. Posting cadence irregularity — near-identical gaps between posts
  // suggest scheduled/automated posting rather than an organic creator.
  if (recentPostTimestamps && recentPostTimestamps.length >= MIN_TIMESTAMPS_FOR_CADENCE) {
    const sorted = [...recentPostTimestamps].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);

    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (mean > 0) {
      const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
      const coefficientOfVariation = Math.sqrt(variance) / mean;
      if (coefficientOfVariation < 0.15) {
        applyDeduction("uniform_posting_cadence", -10);
      }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags, breakdown };
}
