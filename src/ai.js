// One read-only AI tool over what the meters already hold, so a call never adds
// a request to the rate-limited usage endpoints.

import { ctx, state } from "./runtime.js";
import { claudeWindows, codexEmptyNote, codexWindows, reasonText, resetNote } from "./statusbar.js";

const NOT_READY = "Still reading: the first poll has not finished. Try again in a few seconds.";

/** @type {import("../tedi").ContributedAiTool} */
const TOOL = {
  name: "ai_usage",
  description:
    "Read Claude Code and Codex usage per provider, as the status bar meters show it: plan, percent used and reset time of each limit window. Read-only.",
  parameters: {
    type: "object",
    properties: { action: { type: "string", enum: ["read"] } },
  },
};

function windowOut([label, w]) {
  if (!w || w.pct == null) return { label, note: w?.note ?? "no data" };
  return {
    label,
    percentUsed: Math.round(w.pct),
    resets: resetNote(w) || null,
    resetsAt: w.resetsAt ?? null,
    ...(w.dim ? { enforced: false } : {}),
  };
}

function providerOut(u, who, windowsOf) {
  if (!u) return { note: NOT_READY };
  const plan = u.plan ?? null;
  if (!u.ok) return { plan, note: reasonText(u.reason, who) };
  const windows = windowsOf(u).map(windowOut);
  return {
    plan,
    windows,
    ...(windows.length ? {} : { note: codexEmptyNote(u) }),
    ...(u.stale ? { stale: "last known (endpoint busy)" } : {}),
    ...(u.capturedAt ? { asOf: new Date(u.capturedAt).toISOString() } : {}),
  };
}

function handler(args) {
  if (args.action != null && args.action !== "read") {
    return { error: `Unknown action "${args.action}". Use "read".` };
  }
  return {
    claude: providerOut(state.lastClaude, "claude", claudeWindows),
    codex: providerOut(state.lastCodex, "codex", codexWindows),
  };
}

export function registerAiTool() {
  if (typeof ctx?.contribute?.aiTools !== "function") return;
  ctx.contribute.aiTools([TOOL]);
  ctx.registerAiToolHandler(TOOL.name, handler);
}
