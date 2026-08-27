// Codex (ChatGPT) usage. Reads the newest Codex rollout session and returns
// its last known rate-limit snapshot. Codex writes `rate_limits.primary` (the
// ~5-hour window) and `.secondary` (the weekly window) into `token_count`
// events, but leaves them null until it makes an API call - so we scan the
// newest few sessions for the last non-null snapshot. All local file reads,
// no network.

import { ctx } from "./runtime.js";

export async function readCodexUsage(home) {
  const root = `${home}/.codex/sessions`;
  let paths = [];
  try {
    const resp = await ctx.invoke("fs_glob", { pattern: "**/rollout-*.jsonl", root, maxResults: 800 });
    paths = (resp?.hits || []).map((h) => h.path).filter(Boolean);
  } catch {
    return { ok: false, reason: "no-sessions" };
  }
  if (!paths.length) return { ok: false, reason: "no-sessions" };
  // Rollout filenames embed an ISO timestamp, so a descending string sort puts
  // the newest first without needing per-file mtime.
  paths.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  for (const path of paths.slice(0, 6)) {
    const snap = await lastRateLimits(path);
    if (snap) {
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
        capturedAt,
      };
    }
  }
  return { ok: false, reason: "no-rate-data" };
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
