import { test } from "node:test";
import assert from "node:assert/strict";
import { currentWindow, timeUntil } from "./usage-window.js";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 17, h, m));

test("no runs: no window open", () => {
  const w = currentWindow([], [], at(12));
  assert.equal(w.start, null);
  assert.equal(w.research, 0);
});

test("first run opens the window; it resets 8 hours later", () => {
  const w = currentWindow([at(9), at(10)], [at(11)], at(12), 8);
  assert.deepEqual(w.start, at(9));
  assert.deepEqual(w.resetsAt, at(17));
  assert.equal(w.research, 2);
  assert.equal(w.deepDives, 1);
});

test("after the window ends, counters are zero until the next run", () => {
  const w = currentWindow([at(1), at(2)], [], at(10), 8);
  assert.equal(w.start, null);
  assert.equal(w.research, 0);
});

test("the next run after a window ends opens a new one", () => {
  // 01:00 opens a window to 09:00; 09:30 opens the next, to 17:30.
  const w = currentWindow([at(1), at(8), at(9, 30), at(11)], [], at(12), 8);
  assert.deepEqual(w.start, at(9, 30));
  assert.deepEqual(w.resetsAt, at(17, 30));
  assert.equal(w.research, 2);
});

test("timeUntil", () => {
  assert.equal(timeUntil(at(14, 15), at(12)), "2h 15m");
  assert.equal(timeUntil(at(12, 40), at(12)), "40m");
  assert.equal(timeUntil(at(14), at(12)), "2h");
  assert.equal(timeUntil(at(12), at(12)), "under a minute");
});
