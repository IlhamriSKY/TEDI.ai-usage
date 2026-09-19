// The heatmap grid is the one thing here that is easy to get silently wrong:
// a cell that lands in the wrong column dates your activity to the wrong day,
// and nothing about the picture says so. Run with `npm test`.
import assert from "node:assert/strict";
import { byDay, dayKey, heatmap } from "./activity.js";

// Tuesday 8 September 2026, 10:00 local.
const NOW = new Date(2026, 8, 8, 10, 0, 0).getTime();
// 52 whole weeks, then this week up to today (a Tuesday): Sun, Mon, Tue.
const CELLS = 52 * 7 + 3;
/** Index of the cell for a weekday in the last (current) week. Sunday = 0. */
const thisWeek = (weekday) => 52 * 7 + weekday;

// Local day, not UTC: 23:00 belongs to the date on the user's clock.
assert.equal(dayKey(new Date(2026, 8, 8, 23, 30).getTime()), "2026-09-08");
assert.deepEqual(
  [...byDay([new Date(2026, 8, 8, 1).getTime(), new Date(2026, 8, 8, 23).getTime()])],
  [["2026-09-08", 2]],
);

// A full year of weeks, seven rows, laid out as cells.
const grid = heatmap(new Map([["2026-09-08", 5]]), "prompts", NOW);
assert.equal(grid.values.length, CELLS);
assert.equal(grid.rows, 7);
assert.equal(grid.mode, "cells");

// Today is a Tuesday, so it is the third and LAST cell: the rest of the week
// has not happened, and a day that has not happened gets no box at all.
assert.ok(grid.values[thisWeek(2)] > 0, "today is lit");
assert.equal(grid.values.at(-1), grid.values[thisWeek(2)], "today is the last cell");
assert.equal(grid.values[thisWeek(1)], 0, "a day with nothing stays empty");

// The oldest cell is the Sunday 52 weeks back, and it is inside the grid.
const old = heatmap(new Map([["2025-09-14", 1]]), "prompts", NOW);
assert.ok(
  old.values.slice(0, 14).some((v) => v > 0),
  "a day from 51 weeks ago lands in the first columns",
);

// Shades rank a day against the rest of the year, not against the busiest day:
// one huge outlier must not flatten every ordinary day onto the faintest step.
const spread = heatmap(
  new Map([
    ["2026-09-01", 1],
    ["2026-09-02", 2],
    ["2026-09-03", 3],
    ["2026-09-04", 168],
  ]),
  "prompts",
  NOW,
);
const shades = [
  spread.values[thisWeek(2) - 7], // Tue 1 Sep
  spread.values[thisWeek(3) - 7],
  spread.values[thisWeek(4) - 7],
  spread.values[thisWeek(5) - 7], // Fri 4 Sep, the outlier
];
assert.deepEqual(shades, [0.25, 0.5, 0.75, 1]);
assert.equal(spread.note, "174 prompts, 4 active days");

// Every cell names its own day, except the ones that have not happened; every
// column that opens a month names it, and no two labels are within three
// columns of each other (they are absolutely positioned and would collide).
assert.equal(grid.cellLabels.length, CELLS);
assert.equal(grid.columnLabels.length, 53);
assert.match(grid.cellLabels[thisWeek(2)], /8.*Sep|Sep.*8/);
assert.match(grid.cellLabels[thisWeek(2)], /5 prompts/);
assert.match(grid.cellLabels[thisWeek(1)], /no prompts/);
assert.match(
  heatmap(new Map([["2026-09-07", 1]]), "prompts", NOW).cellLabels[thisWeek(1)],
  /1 prompt$/,
);
assert.equal(grid.columnLabels[0], null, "the grid does not open on a label");
assert.ok(
  grid.columnLabels.every((l) => l === null || l.length <= 3),
  "month labels stay three characters wide",
);
const labelled = grid.columnLabels.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
assert.ok(labelled.length >= 11 && labelled.length <= 13, `months labelled: ${labelled.length}`);
assert.ok(
  labelled.every((c, i) => i === 0 || c - labelled[i - 1] >= 3),
  "month labels stay three columns apart",
);

// Nothing to draw is null, not an empty grid the host would still lay out.
assert.equal(heatmap(new Map(), "prompts", NOW), null);
assert.equal(heatmap(null, "prompts", NOW), null);

console.log("activity: ok");
