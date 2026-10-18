// Step states for the shared Stepper, kept pure so it's testable without
// rendering.

export type StepState = "done" | "now" | "todo" | "failed";

/**
 * currentIndex: the step in progress. -1 = not started; >= steps = all done.
 * failed: the current step stopped (it shows as failed, later ones as todo).
 */
export function stepStates(count: number, currentIndex: number, failed = false): StepState[] {
  return Array.from({ length: count }, (_, i) =>
    i < currentIndex ? "done" : i === currentIndex ? (failed ? "failed" : "now") : "todo",
  );
}

export const STEP_GLYPH: Record<StepState, string> = { done: "✓", now: "●", todo: "", failed: "✕" };
export const STEP_WORD: Record<StepState, string> = { done: "done", now: "in progress", todo: "not started", failed: "stopped" };
