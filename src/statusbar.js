// Presentation: turn a provider usage result into a status-bar item (icon +
// percent label + severity-coloured pill bar) and a detail tooltip that draws a
// real progress bar per window. The headline pill tracks the fast 5-hour
// window; the tone tracks the worse of the two windows so a near-cap weekly
// still turns the pill red. Each meter honours its show/hide setting.
//
// The tooltip is provided two ways: `detail` (structured, rendered as real
// bars) and `tooltip` (a plain-text summary kept as the accessible label and a
// fallback on hosts that don't render `detail`).

import { ctx, state } from "./runtime.js";

const CLAUDE_ID = "claude";
const CODEX_ID = "codex";

export function renderClaude(u) {
  if (!state.showClaude) {
    ctx.statusBar.removeItem(CLAUDE_ID);
    return;
  }
  setMeter(CLAUDE_ID, "claude.svg", u, u ? u.fiveHour : null, u ? u.weekly : null, claudeView(u));
}

export function renderCodex(u) {
  if (!state.showCodex) {
    ctx.statusBar.removeItem(CODEX_ID);
    return;
  }
  setMeter(CODEX_ID, "openai.svg", u, u ? u.primary : null, u ? u.secondary : null, codexView(u));
}

export function removeAll() {
  ctx.statusBar.removeItem(CLAUDE_ID);
  ctx.statusBar.removeItem(CODEX_ID);
}

function setMeter(id, icon, u, head5h, headWeek, view) {
  if (!u || !u.ok) {
    // Unavailable: just the dimmed brand icon, the tooltip explains why.
    ctx.statusBar.setItem({ id, icon, tone: "default", tooltip: view.tooltip });
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
    tooltip: view.tooltip,
    detail: view.detail,
  });
}

// Usage severity -> tone. Low = calm (green), climbing = amber, near the cap =
// red. Drives the bar fill colour and the icon tint in the host.
function toneFor(p) {
  if (p == null) return "default";
  if (p >= 90) return "error";
  if (p >= 70) return "warning";
  return "success";
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ---- views: { tooltip: string, detail?: { title, rows } } -----------------

function claudeView(u) {
  const title = "Claude Code" + (u?.plan ? ` (${cap(u.plan)})` : "");
  if (!u) return { tooltip: `${title}\nLoading...` };
  if (!u.ok) return { tooltip: `${title}\n${reasonText(u.reason, "claude")}` };
  const windows = [
    ["5-hour", u.fiveHour],
    ["Weekly", u.weekly],
  ];
  return markStale({ tooltip: textTooltip(title, windows), detail: detailTooltip(title, windows) }, u);
}

// When a value is the last-known one kept across a transient failure (e.g. a
// rate-limit), note it so the meter reads as "not live" without blanking.
function markStale(view, u) {
  if (u?.stale) {
    view.tooltip += "\nlast known (endpoint busy)";
    if (view.detail) view.detail.rows.push({ label: "", note: "last known (endpoint busy)" });
  }
  return view;
}

function codexView(u) {
  const title = "Codex" + (u?.plan ? ` (ChatGPT ${cap(u.plan)})` : " (ChatGPT)");
  if (!u) return { tooltip: `${title}\nLoading...` };
  if (!u.ok) return { tooltip: `${title}\n${reasonText(u.reason, "codex")}` };
  // Codex window sizes vary by plan (5-hour / weekly / 30-day / ...), so label
  // each by its own `window_minutes` rather than assuming 5h + weekly.
  const windows = [];
  for (const w of [u.primary, u.secondary]) {
    if (w && w.pct != null) windows.push([winLabel(w.windowMinutes), w]);
  }
  const asOf = u.capturedAt ? `as of ${ago(u.capturedAt)}` : null;

  if (!windows.length) {
    const text = `${title}\nNo usage recorded yet${asOf ? `\n${asOf}` : ""}`;
    return { tooltip: text, detail: { title, rows: [{ label: "", note: "No usage recorded yet" }] } };
  }
  const text = textTooltip(title, windows) + (asOf ? `\n${asOf}` : "");
  const detail = detailTooltip(title, windows);
  if (asOf) detail.rows.push({ label: "", note: asOf });
  return markStale({ tooltip: text, detail }, u);
}

function textTooltip(title, windows) {
  const lines = [title];
  for (const [label, w] of windows) {
    if (!w || w.pct == null) {
      lines.push(`${label}: no data`);
    } else {
      const reset = resetNote(w);
      lines.push(`${label} ${Math.round(w.pct)}%${reset ? ` ${reset}` : ""}`);
    }
  }
  return lines.join("\n");
}

function detailTooltip(title, windows) {
  const rows = [];
  for (const [label, w] of windows) {
    if (!w || w.pct == null) {
      rows.push({ label, note: "no data" });
    } else {
      rows.push({
        label,
        progress: clamp01(w.pct / 100),
        tone: toneFor(w.pct),
        value: `${Math.round(w.pct)}%`,
        note: resetNote(w),
      });
    }
  }
  return { title, rows };
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

function resetNote(w) {
  if (w.resetsInSeconds != null) return "resets in " + fmtDur(w.resetsInSeconds * 1000);
  if (w.resetsAt) {
    const t = Date.parse(w.resetsAt);
    if (isFinite(t)) {
      const d = t - Date.now();
      return d > 0 ? "resets in " + fmtDur(d) : "resets soon";
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
