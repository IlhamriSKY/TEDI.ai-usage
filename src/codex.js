// Codex (ChatGPT) plan usage, from whichever of the two local records is
// fresher: the file TEDI's own ai-native writes from its response headers, or
// the Codex CLI's rollout snapshots. Activity comes from both sources too:
// TEDI records completed ai-native turns because they do not create Codex CLI
// rollout files. All local file reads, no network.

import { ctx } from "./runtime.js";
import { byDay } from "./activity.js";

// Two possible sources, same account, same backend:
//   1. `~/.tedi/chatgpt-usage.json` - written by TEDI's own ai-native from the
//      `x-codex-*` headers every ChatGPT-account response carries.
//   2. the Codex CLI's `~/.codex/sessions/**\/rollout-*.jsonl` snapshots.
// Whichever was captured more recently wins. Before (1) existed, a user who
// works in ai-native rather than the CLI saw the CLI's last snapshot forever:
// measured here as "Monthly 0%, as of 19d 22h ago" while the account was at
// 42%, and no amount of clicking refresh could move it, because the file it
// re-read was three weeks dead.
export async function readCodexUsage(home) {
  const paths = await rolloutPaths(home);
  // A session's date is in its filename, so the CLI side of the heatmap comes
  // out of the glob that already ran. TEDI's ai-native has a small companion
  // activity file because it does not create Codex CLI rollout files.
  const sessionActivity = paths.length ? sessionDays(paths) : null;
  const [live, cli, appActivity] = await Promise.all([
    readAppUsage(home),
    scanRollouts(paths),
    readAppActivity(home),
  ]);
  const days = mergeDays(sessionActivity, appActivity);
  // Strictly newer wins; ties go to the app, which is the one that keeps
  // updating.
  const best = live && cli ? (cli.capturedAt > live.capturedAt ? cli : live) : (live ?? cli);

  if (!best) return { ok: false, reason: paths.length ? "no-rate-data" : "no-sessions", days };
  return { ...best, days };
}

/** Usage TEDI's own ai-native recorded from the response headers. */
async function readAppUsage(home) {
  let data;
  try {
    const res = await ctx.invoke("fs_read_file", { path: `${home}/.tedi/chatgpt-usage.json` });
    if (res?.kind !== "text" || !res.content) return null;
    data = JSON.parse(res.content);
  } catch {
    return null; // not written yet, or not valid JSON
  }
  const capturedAt = num(data?.capturedAt);
  if (capturedAt == null) return null;
  // Reuse the rollout window parser so both sources age out identically: a
  // window whose reset has passed is dead here too, however it was captured.
  const primary = win(camelWindow(data.primary), capturedAt);
  const secondary = win(camelWindow(data.secondary), capturedAt);
  const hadPct = [data.primary, data.secondary].some((w) => w && w.usedPercent != null);
  if (!hadPct) return null;
  return {
    ok: true,
    plan: data.planType || data.activeLimit || null,
    primary,
    secondary,
    expired: !primary && !secondary,
    capturedAt,
    source: "ai-native",
  };
}

/** Read completed turns recorded by TEDI's ai-native for the activity grid. */
async function readAppActivity(home) {
  try {
    const res = await ctx.invoke("fs_read_file", { path: `${home}/.tedi/chatgpt-activity.json` });
    if (res?.kind !== "text" || !res.content) return null;
    const data = JSON.parse(res.content);
    const events = Array.isArray(data?.events) ? data.events : [];
    const days = byDay(events);
    return days.size ? days : null;
  } catch {
    return null;
  }
}

function mergeDays(...sources) {
  const merged = new Map();
  for (const source of sources) {
    if (!source) continue;
    for (const [day, count] of source) merged.set(day, (merged.get(day) ?? 0) + count);
  }
  return merged.size ? merged : null;
}

/** The app writes camelCase; `win()` speaks the CLI's snake_case. */
function camelWindow(w) {
  if (!w || typeof w !== "object") return null;
  return {
    used_percent: w.usedPercent,
    window_minutes: w.windowMinutes,
    resets_at: w.resetsAt,
  };
}

async function rolloutPaths(home) {
  try {
    const resp = await ctx.invoke("fs_glob", {
      pattern: "**/rollout-*.jsonl",
      root: `${home}/.codex/sessions`,
      maxResults: 800,
    });
    const paths = (resp?.hits || []).map((h) => h.path).filter(Boolean);
    // Rollout filenames embed an ISO timestamp, so a descending string sort
    // puts the newest first without needing per-file mtime.
    paths.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return paths;
  } catch {
    return [];
  }
}

/** Newest non-null rate-limit snapshot the Codex CLI left behind. */
async function scanRollouts(paths) {
  for (const path of paths.slice(0, 6)) {
    const snap = await lastRateLimits(path);
    if (!snap) continue;
    const capturedAt = snap.ts ?? tsFromName(path);
    const primary = win(snap.rl.primary, capturedAt);
    const secondary = win(snap.rl.secondary, capturedAt);
    const hadPct = [snap.rl.primary, snap.rl.secondary].some((w) => w && w.used_percent != null);
    return {
      ok: true,
      plan: snap.rl.plan_type || snap.rl.limit_id || null,
      primary,
      secondary,
      // Every window the snapshot carried has rolled over since it was
      // written, so there is a number on disk but it means nothing now.
      expired: hadPct && !primary && !secondary,
      capturedAt: capturedAt ?? 0,
      source: "codex-cli",
    };
  }
  return null;
}

/** Sessions per local day, from the rollout filenames. */
function sessionDays(paths) {
  const stamps = [];
  for (const p of paths) {
    const t = tsFromName(p);
    if (t != null) stamps.push(t);
  }
  return stamps.length ? byDay(stamps) : null;
}

async function lastRateLimits(path) {
  let text = "";
  try {
    const res = await ctx.invoke("fs_read_file", { path });
    if (res?.kind !== "text" || !res.content) return null; // toolarge / binary -> skip
    text = res.content;
  } catch {
    return null;
  }
  if (text.indexOf("rate_limits") === -1) return null;

  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (!ln || ln.indexOf("rate_limits") === -1) continue;
    let obj;
    try {
      obj = JSON.parse(ln);
    } catch {
      continue;
    }
    const rl = obj?.payload?.rate_limits || obj?.payload?.info?.rate_limits || obj?.rate_limits;
    if (rl && (rl.primary || rl.secondary)) {
      // The event's own timestamp, not the filename's: a session that ran for
      // hours would otherwise date its last snapshot to when it started.
      const ts = Date.parse(obj?.timestamp);
      return { rl, ts: isFinite(ts) ? ts : null };
    }
  }
  return null;
}

// One window object: `{ used_percent, window_minutes, resets_in_seconds }`.
// Parsed defensively (also accepts `resets_at` / `percent`) since the live
// non-null shape can only be confirmed against a fresh session. Returns null
// for a window whose reset time has already passed - see below.
function win(w, capturedAt) {
  if (!w || typeof w !== "object") return null;
  const p = num(w.used_percent) ?? num(w.percent_used) ?? num(w.percent);
  if (p == null) return null;
  const secs = num(w.resets_in_seconds);
  const at = resetMs(w.resets_at) ?? (secs != null && capturedAt ? capturedAt + secs * 1000 : null);
  // A snapshot outlives its own window: Codex writes the file and stops, so a
  // month-old 41% survives every reset that happened since. Once the window has
  // rolled over the number is dead, and showing nothing beats showing a lie.
  if (at != null && at <= Date.now()) return null;
  return {
    pct: p,
    windowMinutes: num(w.window_minutes),
    // Recomputed from the absolute reset time so the countdown ticks down
    // instead of replaying whatever it read when the snapshot was written.
    resetsInSeconds: at != null ? Math.max(0, Math.round((at - Date.now()) / 1000)) : secs,
    resetsAt: at != null ? new Date(at).toISOString() : null,
  };
}

// `resets_at` is epoch SECONDS on the plans seen so far; accept epoch ms and an
// ISO string too rather than betting on one shape.
function resetMs(v) {
  if (typeof v === "number" && isFinite(v)) return v > 1e11 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return isFinite(t) ? t : null;
  }
  return null;
}

function num(x) {
  return typeof x === "number" && isFinite(x) ? x : null;
}

// rollout-2026-05-12T09-50-45-<uuid>.jsonl -> epoch ms (best-effort, for the
// "as of …" freshness note).
function tsFromName(path) {
  const m = /rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(path);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  return isFinite(t) ? t : null;
}
