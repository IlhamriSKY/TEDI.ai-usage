// Check the branches that are easy to get wrong:
//   1. a Codex rate-limit snapshot is a FILE, so it outlives the window it
//      describes;
//   2. there are now TWO sources for the same number (TEDI's ai-native and the
//      Codex CLI) and the FRESHER one has to win - getting this backwards is
//      what pinned the meter to a three-week-old 0% while the account was at
//      42%.
// Run with `npm test`.
import assert from "node:assert/strict";
import { setCtx } from "./runtime.js";
import { readCodexUsage } from "./codex.js";

const PATH = "2026/07/23/rollout-2026-07-23T07-25-43-abc.jsonl";
const CAPTURED = "2026-07-23T00:34:27.050Z";
const APP_FILE = "/home/x/.tedi/chatgpt-usage.json";

// One `token_count` event, exactly the shape Codex writes (resets_at = epoch
// SECONDS, secondary null, 30-day primary on the "go" plan).
const line = (resetsAtSec) =>
  JSON.stringify({
    timestamp: CAPTURED,
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 41.0, window_minutes: 43200, resets_at: resetsAtSec },
        secondary: null,
        plan_type: "go",
      },
    },
  });

// What TEDI's ai-native writes from the response headers (camelCase, epoch MS).
const appFile = (capturedAt, usedPercent, resetsAtMs) =>
  JSON.stringify({
    capturedAt,
    planType: "go",
    activeLimit: "premium",
    primary: { usedPercent, windowMinutes: 43200, resetsAt: resetsAtMs },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: null },
  });

/** @param {{rollouts?: boolean, app?: string|null, resetsAtSec?: number}} o */
function mock({ rollouts = true, app = null, resetsAtSec }) {
  setCtx({
    invoke: async (cmd, args) => {
      if (cmd === "fs_glob") return { hits: rollouts ? [{ path: PATH }] : [] };
      if (args?.path === APP_FILE) {
        if (!app) throw new Error("ENOENT");
        return { kind: "text", content: app };
      }
      return { kind: "text", content: line(resetsAtSec) };
    },
  });
}

const now = Date.now();
const open = Math.floor(now / 1000) + 7200;

// --- the original two cases: the CLI snapshot alone ---
mock({ resetsAtSec: Math.floor(now / 1000) - 3600 });
let u = await readCodexUsage("/home/x");
assert.equal(u.ok, true);
assert.equal(u.primary, null, "expired window must not report a percentage");
assert.equal(u.expired, true);
assert.equal(u.capturedAt, Date.parse(CAPTURED), "capturedAt = event timestamp, not filename");

mock({ resetsAtSec: open });
u = await readCodexUsage("/home/x");
assert.equal(u.primary.pct, 41);
assert.equal(u.expired, false);
assert.ok(u.primary.resetsInSeconds > 7000 && u.primary.resetsInSeconds <= 7200);
assert.equal(u.plan, "go");
assert.equal(u.source, "codex-cli");

// --- the fix: ai-native is newer than the CLI, so it wins ---
mock({ app: appFile(now - 60_000, 42, now + 7_200_000), resetsAtSec: open });
u = await readCodexUsage("/home/x");
assert.equal(u.source, "ai-native", "the fresher record must win");
assert.equal(u.primary.pct, 42);
assert.equal(u.plan, "go");

// --- and the other way round: an OLD app file must not shadow a live CLI run ---
mock({ app: appFile(Date.parse(CAPTURED) - 86_400_000, 5, now + 7_200_000), resetsAtSec: open });
u = await readCodexUsage("/home/x");
assert.equal(u.source, "codex-cli", "the staler record must lose, whoever wrote it");
assert.equal(u.primary.pct, 41);

// --- no Codex CLI on this machine at all: the meter still works ---
mock({ rollouts: false, app: appFile(now - 60_000, 42, now + 7_200_000) });
u = await readCodexUsage("/home/x");
assert.equal(u.ok, true, "a user who never ran the Codex CLI must still get a number");
assert.equal(u.primary.pct, 42);
assert.equal(u.days, null, "no rollouts means no activity grid, not a crash");

// --- an app file whose window already rolled over is dead too ---
mock({ rollouts: false, app: appFile(now - 60_000, 42, now - 1000) });
u = await readCodexUsage("/home/x");
assert.equal(u.primary, null, "an expired window is expired whoever captured it");
assert.equal(u.expired, true);

// --- nothing anywhere ---
mock({ rollouts: false, app: null });
u = await readCodexUsage("/home/x");
assert.equal(u.ok, false);
assert.equal(u.reason, "no-sessions");

console.log("codex usage snapshot: ok");
