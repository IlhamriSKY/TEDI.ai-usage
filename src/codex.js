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
      return {
        ok: true,
        plan: snap.plan_type || snap.limit_id || null,
        primary: win(snap.primary),
        secondary: win(snap.secondary),
        capturedAt: tsFromName(path),
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
    if (rl && (rl.primary || rl.secondary)) return rl;
  }
  return null;
}

// One window object: `{ used_percent, window_minutes, resets_in_seconds }`.
// Parsed defensively (also accepts `resets_at` / `percent`) since the live
// non-null shape can only be confirmed against a fresh session.
function win(w) {
  if (!w || typeof w !== "object") return null;
  const p = num(w.used_percent) ?? num(w.percent_used) ?? num(w.percent);
  if (p == null) return null;
  return {
    pct: p,
    windowMinutes: num(w.window_minutes),
    resetsInSeconds: num(w.resets_in_seconds),
    resetsAt: typeof w.resets_at === "string" ? w.resets_at : null,
  };
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
