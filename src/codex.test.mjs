// Check for the one branch that is easy to get wrong: a Codex rate-limit
// snapshot is a FILE, so it outlives the window it describes. Run with
// `npm test`.
import assert from "node:assert/strict";
import { setCtx } from "./runtime.js";
import { readCodexUsage } from "./codex.js";

const PATH = "2026/07/23/rollout-2026-07-23T07-25-43-abc.jsonl";
const CAPTURED = "2026-07-23T00:34:27.050Z";

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

function mock(resetsAtSec) {
  setCtx({
    invoke: async (cmd) =>
      cmd === "fs_glob"
        ? { hits: [{ path: PATH }] }
        : { kind: "text", content: line(resetsAtSec) },
  });
}

const now = Date.now();

// Window already rolled over -> the percentage is dropped, not reported.
mock(Math.floor(now / 1000) - 3600);
let u = await readCodexUsage("/home/x");
assert.equal(u.ok, true);
assert.equal(u.primary, null, "expired window must not report a percentage");
assert.equal(u.expired, true);
assert.equal(u.capturedAt, Date.parse(CAPTURED), "capturedAt = event timestamp, not filename");

// Window still open -> the percentage stands and the countdown is live.
mock(Math.floor(now / 1000) + 7200);
u = await readCodexUsage("/home/x");
assert.equal(u.primary.pct, 41);
assert.equal(u.expired, false);
assert.ok(u.primary.resetsInSeconds > 7000 && u.primary.resetsInSeconds <= 7200);
assert.equal(u.plan, "go");

console.log("codex usage snapshot: ok");
