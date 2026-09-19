// The hover heatmap: a year of daily activity drawn the way GitHub draws
// contributions - a column per week, a row per weekday, the shade of a cell set
// by how busy that day was against the rest of the year.
//
// The host renders this as `StatusItem.detail.chart` with `mode: "cells"`: one
// value per cell, column-major, oldest first. All this module does is bucket
// timestamps by local day and lay them out on that grid.

/** Weeks drawn. 53 covers a full year plus the partial week we are in, and is
 *  exactly what the host's cells grid holds. */
const WEEKS = 53;

/**
 * Local `YYYY-MM-DD` for an epoch-ms timestamp.
 *
 * A day is the user's day: a session at 23:00 belongs to the date they saw on
 * the clock, not to whatever UTC had rolled over to.
 */
export function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Count per local day, from epoch-ms timestamps in any order. */
export function byDay(timestamps) {
  const days = new Map();
  for (const ts of timestamps) {
    if (typeof ts !== "number" || !isFinite(ts)) continue;
    const k = dayKey(ts);
    days.set(k, (days.get(k) ?? 0) + 1);
  }
  return days;
}

/**
 * A `detail.chart` for the last 53 weeks, or null when there is nothing to
 * draw. `unit` names what was counted, for the caption ("prompts", "sessions").
 *
 * `now` is injectable so the grid can be tested against a fixed day.
 */
export function heatmap(days, unit, now = Date.now()) {
  if (!days || days.size === 0) return null;
  // Start on the Sunday 52 weeks before this week's Sunday, so the grid ends
  // with the week we are in and every column is a whole week.
  const cur = weekStart(now);
  cur.setDate(cur.getDate() - (WEEKS - 1) * 7);

  const today = dayKey(now);
  const counts = [];
  // A square in a grid of 371 cannot say which day it is, so every cell carries
  // its own date and count for the host to show while the pointer is on it, and
  // each column that opens a new month carries that month's name.
  const cellLabels = [];
  const columnLabels = [];
  // Seeded with the first column's month so the grid does not open on a label:
  // the window starts mid-month, and a leading "Sep" next to the trailing "Sep"
  // of the month we are actually in reads as a mistake.
  let lastMonth = cur.getMonth();
  let lastLabelCol = -9;
  for (let i = 0; i < WEEKS * 7; i++) {
    const key = dayKey(cur.getTime());
    // The grid ends today: the rest of this week has not happened, so it gets
    // no cell at all and the last column is simply shorter. ISO dates compare
    // as strings, so this is the whole check.
    if (key > today) break;
    const n = days.get(key) ?? 0;
    counts.push(n);
    cellLabels.push(`${dateLabel(cur)} - ${countLabel(n, unit)}`);
    if (i % 7 === 0) {
      // Label the week that opens a month, but never two labels within three
      // columns: they are absolutely positioned and would overlap.
      const col = i / 7;
      const month = cur.getMonth();
      const open = month !== lastMonth && col - lastLabelCol >= 3;
      columnLabels.push(open ? monthLabel(cur) : null);
      if (open) lastLabelCol = col;
      lastMonth = month;
    }
    // Stepping the DATE rather than adding 86_400_000 keeps the walk correct
    // across a DST change, where a "day" is 23 or 25 hours long.
    cur.setDate(cur.getDate() + 1);
  }

  const active = counts.filter((c) => c > 0);
  if (!active.length) return null;
  const steps = quartiles(active);
  return {
    mode: "cells",
    rows: 7,
    tone: "success",
    // 4 shades, so a value is the step index over the step count.
    values: counts.map((c) => (c > 0 ? (1 + steps.filter((t) => c > t).length) / 4 : 0)),
    cellLabels,
    columnLabels,
    label: "last 12 months",
    note: `${total(active).toLocaleString()} ${unit}, ${active.length} active days`,
  };
}

// Dates in the user's own locale and language, which is what the rest of the
// tooltip already does with `toLocaleString` on the totals.
const dateLabel = (d) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
// Three characters, because a month sits over a 7 px column: English "short" is
// "Sept" for one month out of twelve, and that one is wide enough to lean into
// its neighbour. Locales whose short month is already shorter are unaffected.
const monthLabel = (d) => d.toLocaleDateString(undefined, { month: "short" }).slice(0, 3);

// "14 prompts", "1 prompt", "no prompts". `unit` is plural, so the singular is
// it without its final s - true for the two units this ships with.
function countLabel(n, unit) {
  if (n === 0) return `no ${unit}`;
  return `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
}

/** Midnight on the Sunday of `ms`'s week, in local time. */
function weekStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/**
 * The three counts that split the ACTIVE days into four shades.
 *
 * Shading against the busiest day instead would flatten the chart: one
 * 168-prompt afternoon in a year of 20-prompt days puts every ordinary day on
 * the faintest step. Quartiles rank a day against the rest of the year, which
 * is what makes the GitHub grid readable.
 */
function quartiles(active) {
  const sorted = [...active].sort((a, b) => a - b);
  return [0.25, 0.5, 0.75].map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
}

function total(counts) {
  let n = 0;
  for (const c of counts) n += c;
  return n;
}
