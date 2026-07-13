// AI Usage Meter - status-bar meters for Claude Code + Codex (ChatGPT) usage.
//
// Two status items (claude, codex), each a provider glyph + percent + a
// progress bar coloured by severity, with a tooltip that draws a bar for the
// 5-hour and weekly windows plus a reset countdown. Each meter can be hidden
// from the extension's Settings card. Data sources:
//   Claude -> ~/.claude/.credentials.json (or macOS Keychain) -> oauth/usage
//   Codex  -> newest ~/.codex/sessions/**/rollout-*.jsonl rate_limits snapshot
// Runs on a 60s poll; nothing is written, only read. Modules:
//   runtime.js   - ctx + state + home resolution
//   claude.js    - Claude usage via the OAuth endpoint (through curl)
//   codex.js     - Codex usage from the newest rollout file
//   statusbar.js - usage result -> status-bar item + tooltip

import { ctx, setCtx, state, clearTimer, resolveHome } from "./runtime.js";
import { readClaudeUsage } from "./claude.js";
import { readCodexUsage } from "./codex.js";
import { renderClaude, renderCodex, removeAll } from "./statusbar.js";

const POLL_MS = 60_000;

export async function activate(context) {
  setCtx(context);
  state.active = true;

  // Settings card: two switches to show/hide each meter.
  ctx.contribute.settings([
    { id: "showClaude", type: "boolean", label: "Show Claude Code meter", default: true },
    { id: "showCodex", type: "boolean", label: "Show Codex (ChatGPT) meter", default: true },
  ]);
  state.showClaude = (await ctx.settings.get("showClaude")) !== false;
  state.showCodex = (await ctx.settings.get("showCodex")) !== false;
  // Re-render from the cached result on toggle, so hide/show is instant.
  ctx.settings.onChange("showClaude", (v) => {
    state.showClaude = v !== false;
    renderClaude(state.lastClaude);
  });
  ctx.settings.onChange("showCodex", (v) => {
    state.showCodex = v !== false;
    renderCodex(state.lastCodex);
  });

  // Seed both meters immediately so the icons appear while the first poll runs.
  renderClaude(null);
  renderCodex(null);

  await refresh();
  // Guard against a deactivate() that raced the first `await refresh()`: if the
  // extension was torn down mid-refresh, don't start (and orphan) a timer.
  if (state.active) state.timer = setInterval(refresh, POLL_MS);
}

async function refresh() {
  if (!state.active) return;
  const home = await resolveHome();
  if (!home || !state.active) return;

  const platform = ctx?.os?.platform ?? "unknown";
  const [claude, codex] = await Promise.allSettled([
    readClaudeUsage(home, platform),
    readCodexUsage(home),
  ]);
  if (!state.active) return;

  state.lastClaude = claude.status === "fulfilled" ? claude.value : null;
  state.lastCodex = codex.status === "fulfilled" ? codex.value : null;
  renderClaude(state.lastClaude);
  renderCodex(state.lastCodex);
}

export async function deactivate() {
  state.active = false;
  clearTimer();
  removeAll();
}
