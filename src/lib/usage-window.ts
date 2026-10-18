/**
 * Work-window usage limits, modeled on Claude's usage window: the first
 * run (quick profile or Deep Dive) opens a window, both counters reset
 * WINDOW_HOURS later, and the next run after that opens a new window.
 * Replaces the old midnight-reset daily caps, which reset at a time that
 * meant nothing to the user (server midnight) and could be doubled by
 * working across it.
 *
 * Pure: the caller fetches timestamps, this works out the window.
 */

export const WINDOW_HOURS = Number(process.env.USAGE_WINDOW_HOURS ?? 8);

/** How far back to look for the run that anchors the current window.
 *  Windows chain (each starts at the first run after the previous one
 *  ended), so the anchor depends on earlier runs. Three windows back is
 *  enough in practice: a chain longer than that implies non-stop use for
 *  a full day, where the result is the same either way. */
export const WINDOW_LOOKBACK_MS = 3 * WINDOW_HOURS * 60 * 60 * 1000;

export interface UsageWindow {
  /** Start of the current window, or null when none is open (the next
   *  run will open one). */
  start: Date | null;
  /** When the current window's counters reset; null when none is open. */
  resetsAt: Date | null;
  research: number;
  deepDives: number;
}

export function currentWindow(
  researchTimes: Date[],
  deepDiveTimes: Date[],
  now = new Date(),
  hours = WINDOW_HOURS,
): UsageWindow {
  const windowMs = hours * 60 * 60 * 1000;
  const runs = [
    ...researchTimes.map((t) => ({ t: t.getTime(), kind: "research" as const })),
    ...deepDiveTimes.map((t) => ({ t: t.getTime(), kind: "deep" as const })),
  ].filter((r) => r.t <= now.getTime()).sort((a, b) => a.t - b.t);

  let start: number | null = null;
  for (const r of runs) {
    if (start === null || r.t >= start + windowMs) start = r.t;
  }
  if (start === null || now.getTime() >= start + windowMs) {
    return { start: null, resetsAt: null, research: 0, deepDives: 0 };
  }
  const inWindow = runs.filter((r) => r.t >= start!);
  return {
    start: new Date(start),
    resetsAt: new Date(start + windowMs),
    research: inWindow.filter((r) => r.kind === "research").length,
    deepDives: inWindow.filter((r) => r.kind === "deep").length,
  };
}

/** "2h 15m", "40m", "under a minute". */
export function timeUntil(when: Date, now = new Date()): string {
  const mins = Math.ceil((when.getTime() - now.getTime()) / 60000);
  if (mins < 1) return "under a minute";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
