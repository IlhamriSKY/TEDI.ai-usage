// Presentation: turn a provider usage result into a status-bar item (icon +
// percent label + severity-coloured progress bar) and a multiline detail
// tooltip. The headline bar tracks the fast 5-hour window; the tone tracks the
// worse of the two windows so a near-cap weekly still turns the pill red.

import { ctx } from "./runtime.js";

const CLAUDE_ID = "claude";
const CODEX_ID = "codex";

// Icons are a BARE relative asset path (the host reads `<ext-root>/<path>` via
// ext_read_asset_bytes). Do NOT prefix `ext-asset:` - that prefix is not
// stripped anywhere in the icon-resolution path, so it resolves to a missing
// file and renders a blank box.
export function renderClaude(u) {
  setMeter(CLAUDE_ID, "claude.svg", u, u ? u.fiveHour : null, u ? u.weekly : null, claudeTooltip(u));
}

export function renderCodex(u) {
  setMeter(CODEX_ID, "openai.svg", u, u ? u.primary : null, u ? u.secondary : null, codexTooltip(u));
}

export function removeAll() {
  ctx.statusBar.removeItem(CLAUDE_ID);
  ctx.statusBar.removeItem(CODEX_ID);
}

function setMeter(id, icon, u, head5h, headWeek, tooltip) {
  if (!u || !u.ok) {
    ctx.statusBar.setItem({ id, icon, tone: "default", label: "—", tooltip });
    return;
  }
  const head = head5h || headWeek; // headline = 5-hour window, else weekly
  const worst = Math.max(head5h?.pct ?? 0, headWeek?.pct ?? 0);
  ctx.statusBar.setItem({
    id,
    icon,
    tone: toneFor(worst),
    label: head ? `${Math.round(head.pct)}%` : "—",
    progress: head ? clamp01(head.pct / 100) : undefined,
    tooltip,
  });
}

// Usage severity -> tone. Low = calm (green), climbing = amber, near the cap =
// red. Drives both the bar fill colour and the icon tint in the host.
function toneFor(p) {
  if (p == null) return "default";
  if (p >= 90) return "error";
  if (p >= 70) return "warning";
  return "success";
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ---- tooltips (multiline; "\n" renders as line breaks in the host) --------

function claudeTooltip(u) {
  const title = "Claude Code" + (u?.plan ? ` — ${cap(u.plan)}` : "");
  if (!u) return `${title}\nLoading…`;
  if (!u.ok) return `${title}\n${reasonText(u.reason, "claude")}`;
  return [title, windowLine("5-hour", u.fiveHour), windowLine("Weekly", u.weekly)].join("\n");
}

function codexTooltip(u) {
  const title = "Codex (ChatGPT)" + (u?.plan ? ` — ${cap(u.plan)}` : "");
  if (!u) return `${title}\nLoading…`;
  if (!u.ok) return `${title}\n${reasonText(u.reason, "codex")}`;
  // Codex's window sizes vary by plan (5-hour / weekly / 30-day / …), so label
  // each by its own `window_minutes` rather than assuming 5h + weekly.
  const rows = [title];
  for (const w of [u.primary, u.secondary]) {
    if (w && w.pct != null) rows.push(windowLine(winLabel(w.windowMinutes), w));
  }
  if (rows.length === 1) rows.push("No usage recorded yet");
  if (u.capturedAt) rows.push(`as of ${ago(u.capturedAt)}`);
  return rows.join("\n");
}

// window_minutes -> a human label. 300 -> "5-hour", 10080 -> "Weekly",
// 43200 -> "Monthly", etc. Falls back to a plain duration.
function winLabel(mins) {
  if (mins == null) return "Usage";
  if (mins % 1440 === 0) {
    const d = mins / 1440;
    return d === 1 ? "Daily" : d === 7 ? "Weekly" : d === 30 ? "Monthly" : `${d}-day`;
  }
  if (mins % 60 === 0) return `${mins / 60}-hour`;
  return `${mins}-min`;
}

function windowLine(label, w) {
  if (!w || w.pct == null) return `${label}: no data`;
  const reset = resetText(w);
  // Single spaces around the middot: the host tooltip uses `white-space:
  // pre-line`, which collapses runs of spaces anyway.
  return `${label}: ${Math.round(w.pct)}%${reset ? ` · resets ${reset}` : ""}`;
}

function resetText(w) {
  if (w.resetsInSeconds != null) return "in " + fmtDur(w.resetsInSeconds * 1000);
  if (w.resetsAt) {
    const t = Date.parse(w.resetsAt);
    if (isFinite(t)) {
      const d = t - Date.now();
      return d > 0 ? "in " + fmtDur(d) : "soon";
    }
  }
  return "";
}

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ago(ms) {
  const d = Date.now() - ms;
  return d <= 0 ? "just now" : fmtDur(d) + " ago";
}

function reasonText(reason, who) {
  switch (reason) {
    case "not-signed-in":
      return "Not signed in — run Claude Code once to sign in";
    case "no-sessions":
      return "No Codex sessions found";
    case "no-rate-data":
      return "No usage recorded yet — run Codex to refresh";
    case "rate-limited":
      return "Usage endpoint busy — retrying…";
    case "unreachable":
      return "Couldn't reach the usage endpoint";
    default:
      return who === "claude" ? "Claude usage unavailable" : "Codex usage unavailable";
  }
}

function cap(s) {
  s = String(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
