// When Claude Code was actually used, for the heatmap.
//
// `~/.claude/history.jsonl` is one line per prompt you send, across every
// project: `{display, timestamp, project, sessionId}`, appended live. It is the
// only local record of activity that stays current - `stats-cache.json` already
// holds this exact shape under `dailyActivity`, but Claude Code only recomputes
// it when you open the usage view, so it is usually months stale.
//
// The usage ENDPOINT cannot answer this: it reports the current window's
// utilization, not a history.
//
// Known ceiling: the file grows unbounded (~1.5 MB after six months of daily
// use) and `fs_read_file` stops at 10 MB, at which point this returns null and
// the meter simply loses its chart. Splitting it by month would need the file
// to be indexed, which it is not.

import { ctx } from "./runtime.js";
import { byDay } from "./activity.js";

/** Count of prompts per local day, or null when there is no readable history. */
export async function readClaudeDays(home) {
  let text = "";
  try {
    const res = await ctx.invoke("fs_read_file", { path: `${home}/.claude/history.jsonl` });
    if (res?.kind !== "text" || !res.content) return null; // absent, or past the read cap
    text = res.content;
  } catch {
    return null;
  }

  const stamps = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    // Parsed, not pattern-matched: a prompt's own pasted content can contain
    // the literal text `"timestamp":1788…`, and a regex would count it.
    try {
      const ts = JSON.parse(line)?.timestamp;
      if (typeof ts === "number") stamps.push(ts);
    } catch {
      // A line half-written by the CLI as we read, or a format change.
    }
  }
  return stamps.length ? byDay(stamps) : null;
}
