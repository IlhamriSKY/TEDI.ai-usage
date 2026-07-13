// Presentation: turn a provider usage result into a status-bar item (icon +
// percent label + severity-coloured progress bar) and a multiline detail
// tooltip that draws a unicode bar for each window. The headline bar tracks the
// fast 5-hour window; the tone tracks the worse of the two windows so a
// near-cap weekly still turns the pill red. Each meter honours its
// show/hide setting.

import { ctx, state } from "./runtime.js";

const CLAUDE_ID = "claude";
const CODEX_ID = "codex";

export function renderClaude(u) {
  if (!state.showClaude) {
    ctx.statusBar.removeItem(CLAUDE_ID);
    return;
  }
  setMeter(CLAUDE_ID, "claude.svg", u, u ? u.fiveHour : null, u ? u.weekly : null, claudeTooltip(u));
}

export function renderCodex(u) {
  if (!state.showCodex) {
    ctx.statusBar.removeItem(CODEX_ID);
    return;
  }
  setMeter(CODEX_ID, "openai.svg", u, u ? u.primary : null, u ? u.secondary : null, codexTooltip(u));
}

export function removeAll() {
  ctx.statusBar.removeItem(CLAUDE_ID);
  ctx.statusBar.removeItem(CODEX_ID);
}

function setMeter(id, icon, u, head5h, headWeek, tooltip) {
  if (!u || !u.ok) {
    // Unavailable: just the dimmed brand icon, the tooltip explains why.
    ctx.statusBar.setItem({ id, icon, tone: "default", tooltip });
    return;
  }
  const head = head5h || headWeek; // headline = 5-hour window, else weekly
  const worst = Math.max(head5h?.pct ?? 0, headWeek?.pct ?? 0);
  ctx.statusBar.setItem({
    id,
    icon,
    tone: toneFor(worst),
    label: head ? `${Math.round(head.pct)}%` : undefined,
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

// A 10-cell unicode bar, e.g. 42% renders as "████░░░░░░". Block glyphs keep a
// uniform width even in the tooltip's proportional font.
function bar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ---- tooltips (multiline; "\n" renders as line breaks in the host) --------

function claudeTooltip(u) {
  const title = "Claude Code" + (u?.plan ? ` (${cap(u.plan)})` : "");
  if (!u) return `${title}\nLoading...`;
  if (!u.ok) return `${title}\n${reasonText(u.reason, "claude")}`;
  return [title, windowLine("5-hour", u.fiveHour), windowLine("Weekly", u.weekly)].join("\n");
}

function codexTooltip(u) {
  const title = "Codex" + (u?.plan ? ` (ChatGPT ${cap(u.plan)})` : " (ChatGPT)");
  if (!u) return `${title}\nLoading...`;
  if (!u.ok) return `${title}\n${reasonText(u.reason, "codex")}`;
  // Codex window sizes vary by plan (5-hour / weekly / 30-day / ...), so label
  // each by its own `window_minutes` rather than assuming 5h + weekly.
  const rows = [title];
  for (const w of [u.primary, u.secondary]) {
    if (w && w.pct != null) rows.push(windowLine(winLabel(w.windowMinutes), w));
  }
  if (rows.length === 1) rows.push("No usage recorded yet");
  if (u.capturedAt) rows.push(`as of ${ago(u.capturedAt)}`);
  return rows.join("\n");
}

function windowLine(label, w) {
  if (!w || w.pct == null) return `${label}: no data`;
  const reset = resetText(w);
  return `${label} ${bar(w.pct)} ${Math.round(w.pct)}%${reset ? ` resets ${reset}` : ""}`;
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
      return "Not signed in. Run Claude Code once to sign in.";
    case "no-sessions":
      return "No Codex sessions found";
    case "no-rate-data":
      return "No usage recorded yet. Run Codex to refresh.";
    case "rate-limited":
      return "Usage endpoint busy, retrying...";
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
