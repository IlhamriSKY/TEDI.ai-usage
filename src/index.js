// AI Usage Meter - status-bar meters for Claude Code + Codex (ChatGPT) usage.
//
// Two status items (claude, codex), each a provider glyph + percent + a pixel
// progress bar coloured by severity, with a tooltip that draws a bar for the
// 5-hour and weekly windows plus a reset countdown. The Settings card has a
// show/hide switch per provider, each labelled with the signed-in account.
// Data sources:
//   Claude -> ~/.claude/.credentials.json (or macOS Keychain) -> oauth/usage
//   Codex  -> newest ~/.codex/sessions/**/rollout-*.jsonl rate_limits snapshot
//   Accounts -> ~/.claude.json + ~/.codex/auth.json (id_token)
// Runs on a 60s poll; nothing is written, only read.

import { ctx, setCtx, state, clearTimer, resolveHome } from "./runtime.js";
import { readClaudeUsage } from "./claude.js";
import { readCodexUsage } from "./codex.js";
import { readClaudeAccount, readCodexAccount } from "./accounts.js";
import { renderClaude, renderCodex, removeAll } from "./statusbar.js";

const POLL_MS = 60_000;

export async function activate(context) {
  setCtx(context);
  state.active = true;

  // Read + watch the show/hide switches. Guarded so a missing `settings:read`
  // permission (e.g. a stale approval) degrades to "show both" instead of
  // killing activation. The switches themselves are declared in the manifest
  // (contributes.settings), so the card shows even if this throws.
  try {
    state.showClaude = (await ctx.settings.get("showClaude")) !== false;
    state.showCodex = (await ctx.settings.get("showCodex")) !== false;
    ctx.settings.onChange("showClaude", (v) => {
      state.showClaude = v !== false;
      renderClaude(state.lastClaude);
    });
    ctx.settings.onChange("showCodex", (v) => {
      state.showCodex = v !== false;
      renderCodex(state.lastCodex);
    });
  } catch (err) {
    ctx.logger?.info?.("settings unavailable, showing both meters", err);
  }

  // Seed both meters immediately so the icons appear while the first poll runs.
  renderClaude(null);
  renderCodex(null);

  // Enrich the Settings card with the signed-in account per provider (read once;
  // accounts rarely change within a session).
  const home = await resolveHome();
  if (home) {
    try {
      const [claudeAcc, codexAcc] = await Promise.all([
        readClaudeAccount(home),
        readCodexAccount(home),
      ]);
      contributeSettings(claudeAcc, codexAcc);
    } catch (err) {
      ctx.logger?.info?.("account read failed", err);
    }
  }

  await refresh();
  // Guard against a deactivate() that raced the first `await refresh()`.
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

// Re-declare the two switches with the signed-in account in each description.
// Replaces the manifest-declared pair (same ids) with the enriched version.
function contributeSettings(claudeAcc, codexAcc) {
  ctx.contribute.settings([
    {
      id: "showClaude",
      type: "boolean",
      label: "Show Claude Code meter",
      default: true,
      description: accountLine(claudeAcc, "claude"),
    },
    {
      id: "showCodex",
      type: "boolean",
      label: "Show Codex (ChatGPT) meter",
      default: true,
      description: accountLine(codexAcc, "codex"),
    },
  ]);
}

function accountLine(acc, provider) {
  if (!acc || !acc.signedIn) return "Not signed in.";
  const who = acc.email || "Signed in";
  const plan = acc.plan ? ` (${planLabel(acc.plan, provider)})` : "";
  return `Signed in: ${who}${plan}`;
}

function planLabel(plan, provider) {
  const p = String(plan);
  const cap = p.charAt(0).toUpperCase() + p.slice(1);
  return provider === "codex" ? `ChatGPT ${cap}` : cap;
}

export async function deactivate() {
  state.active = false;
  clearTimer();
  removeAll();
}
