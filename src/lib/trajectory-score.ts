// Growth trajectory score — reads a creator's creator_snapshots history
// and distinguishes a steady organic climb from a "staircase" — a spike
// then a flatline (the shape a purchased-follower burst leaves behind).
// Combines with the per-snapshot bot score from bot-score.ts into one
// ranking number.
//
// Gated behind MIN_DATA_POINTS: with only a few days of history the
// day-over-day rate is mostly noise, so callers should treat
// "insufficient_data" as "don't show/rank this yet," not as a score of 0.

export interface SnapshotPoint {
  snapshotDate: string; // ISO date, YYYY-MM-DD
  followerCount: number;
  botScore: number; // 0-100, from computeBotScore at that snapshot
}

export type TrajectoryLabel =
  | "organic_growth"
  | "staircase"
  | "declining"
  | "flat"
  | "insufficient_data";

export interface TrajectoryResult {
  trajectoryScore: number; // 0-100, only meaningful when label !== "insufficient_data"
  label: TrajectoryLabel;
  dataPoints: number;
}

export const MIN_DATA_POINTS = 7;

// A single day's growth counts as a "spike" if it's both a large jump in
// absolute terms and far outside the account's own average daily pace —
// the second condition is what keeps this from flagging small accounts'
// normal day-to-day noise.
const SPIKE_ABSOLUTE_THRESHOLD = 0.15; // 15% single-day follower jump
const SPIKE_RELATIVE_MULTIPLE = 5; // vs. mean of the other days
const PLATEAU_THRESHOLD = 0.01; // <1% daily growth counts as "flat" after a spike

export function computeTrajectoryScore(history: SnapshotPoint[]): TrajectoryResult {
  const sorted = [...history].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  if (sorted.length < MIN_DATA_POINTS) {
    return { trajectoryScore: 0, label: "insufficient_data", dataPoints: sorted.length };
  }

  const dailyGrowthRates: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].followerCount;
    const curr = sorted[i].followerCount;
    if (prev > 0) dailyGrowthRates.push((curr - prev) / prev);
  }

  const meanGrowth = dailyGrowthRates.reduce((s, g) => s + g, 0) / dailyGrowthRates.length;
  const positiveDays = dailyGrowthRates.filter((g) => g > 0).length;
  const consistency = positiveDays / dailyGrowthRates.length;

  const maxGrowth = Math.max(...dailyGrowthRates);
  const maxGrowthIndex = dailyGrowthRates.indexOf(maxGrowth);
  const restMean =
    dailyGrowthRates.filter((_, i) => i !== maxGrowthIndex).reduce((s, g) => s + g, 0) /
    Math.max(dailyGrowthRates.length - 1, 1);

  const isSpike =
    maxGrowth > SPIKE_ABSOLUTE_THRESHOLD && maxGrowth > restMean * SPIKE_RELATIVE_MULTIPLE;
  const afterSpike = dailyGrowthRates.slice(maxGrowthIndex + 1);
  const plateauedAfterSpike =
    isSpike && afterSpike.length > 0 && afterSpike.every((g) => Math.abs(g) < PLATEAU_THRESHOLD);

  let label: TrajectoryLabel;
  if (isSpike && plateauedAfterSpike) label = "staircase";
  else if (meanGrowth > 0.005 && consistency >= 0.6) label = "organic_growth";
  else if (meanGrowth < -0.005) label = "declining";
  else label = "flat";

  const avgBotScore = sorted.reduce((s, p) => s + p.botScore, 0) / sorted.length;

  // Composite: reward steady positive growth and a high average bot
  // (authenticity) score, penalize the staircase pattern (spike then
  // flatline — the shape a purchased-follower burst leaves behind)
  // outright regardless of raw growth rate.
  let trajectoryScore = 50 + meanGrowth * 1000 + (consistency - 0.5) * 40 + (avgBotScore - 50) * 0.3;
  if (label === "staircase") trajectoryScore -= 30;

  return {
    trajectoryScore: Math.max(0, Math.min(100, Math.round(trajectoryScore))),
    label,
    dataPoints: sorted.length,
  };
}
