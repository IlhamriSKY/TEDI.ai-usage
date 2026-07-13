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

// The Claude usage endpoint 429s aggressively at 30-60s (a known Claude Code
// issue: anthropics/claude-code#31637), so poll gently and back off hard on 429.
const POLL_MS = 5 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;

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

  // Restore the last known values from storage, so a restart during a rate-limit
  // window still shows the last percentages (marked stale) instead of blanking.
  try {
    const [pc, px] = await Promise.all([
      ctx.storage.get("lastClaude"),
      ctx.storage.get("lastCodex"),
    ]);
    if (pc?.ok) {
      state.lastClaude = { ...pc, stale: true };
      renderClaude(state.lastClaude);
    }
    if (px?.ok) {
      state.lastCodex = { ...px, stale: true };
      renderCodex(state.lastCodex);
    }
  } catch {
    /* no cache yet */
  }

  // Enrich the Settings card with the signed-in account per provider (read once;
  // accounts rarely change within a session).
  const home = await resolveHome();
  if (home) {
    try {
      const [claudeAcc, codexAcc] = await Promise.all([
        readClaudeAccount(home),
        readCodexAccount(home),
      ]);
      // The account rows are read-only "note" settings declared in the manifest;
      // their values sync to the (separate) Settings window through the store.
      await ctx.settings.set("claudeAccount", accountLine(claudeAcc, "claude"));
      await ctx.settings.set("codexAccount", accountLine(codexAcc, "codex"));
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
  // Skip the Claude network call while backing off from a 429; Codex is a local
  // read and always runs.
  const claudeP =
    Date.now() < state.claudeCooldownUntil
      ? Promise.resolve(null)
      : readClaudeUsage(home, platform);
  const [claude, codex] = await Promise.allSettled([claudeP, readCodexUsage(home)]);
  if (!state.active) return;

  const claudeVal = claude.status === "fulfilled" ? claude.value : null;
  const codexVal = codex.status === "fulfilled" ? codex.value : null;

  if (claudeVal?.reason === "rate-limited") {
    // Respect Retry-After when present and non-zero; else back off 15 minutes
    // (the endpoint usually omits it and stays 429 for a long while).
    const ra = claudeVal.retryAfterSec;
    state.claudeCooldownUntil =
      Date.now() + (ra && ra > 0 ? Math.max(ra * 1000, 60_000) : RATE_LIMIT_COOLDOWN_MS);
  } else if (claudeVal?.ok) {
    state.claudeCooldownUntil = 0;
    void ctx.storage.set("lastClaude", claudeVal).catch(() => {});
  }
  if (codexVal?.ok) void ctx.storage.set("lastCodex", codexVal).catch(() => {});

  // Keep the last good value across a transient failure (marked stale).
  state.lastClaude = mergeUsage(state.lastClaude, claudeVal);
  state.lastCodex = mergeUsage(state.lastCodex, codexVal);
  renderClaude(state.lastClaude);
  renderCodex(state.lastCodex);
}

// Keep the last GOOD value across a transient failure, marking it stale so the
// meter shows the last known percentages instead of blanking.
function mergeUsage(prev, next) {
  if (next?.ok) return next;
  if (prev?.ok) return { ...prev, stale: true };
  return next ?? prev ?? null;
}

// The value shown in a provider's read-only "note" row: "<email> (<plan>)".
function accountLine(acc, provider) {
  if (!acc || !acc.signedIn) return "Not signed in";
  const who = acc.email || "Signed in";
  const plan = acc.plan ? ` (${planLabel(acc.plan, provider)})` : "";
  return `${who}${plan}`;
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
