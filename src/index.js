// AI Usage Meter - status-bar meters for Claude Code + Codex (ChatGPT) usage.
//
// Two status items (claude, codex), each a provider glyph + percent + a
// progress bar coloured by severity, with a tooltip that breaks out the 5-hour
// and weekly windows with reset countdowns. Data sources:
//   Claude -> ~/.claude/.credentials.json token -> api.anthropic.com oauth/usage
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

  // Seed both meters immediately so the icons appear while the first poll runs.
  renderClaude(null);
  renderCodex(null);

  await refresh();
  state.timer = setInterval(refresh, POLL_MS);
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

  renderClaude(claude.status === "fulfilled" ? claude.value : null);
  renderCodex(codex.status === "fulfilled" ? codex.value : null);
}

export async function deactivate() {
  state.active = false;
  clearTimer();
  removeAll();
}
