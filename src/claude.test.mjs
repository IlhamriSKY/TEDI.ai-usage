// The plan name decides whether a missing 5-hour window is "no data" or "no
// limit on Ultra", and logins made before the Max 20x -> Ultra rename still
// say `subscriptionType: "max"`. Run with `npm test`.
import assert from "node:assert/strict";
import { planName, sessionInactive } from "./claude.js";

assert.equal(planName({ subscriptionType: "max", rateLimitTier: "default_claude_max_20x" }), "Ultra");
assert.equal(planName({ subscriptionType: "max", rateLimitTier: "default_claude_max_5x" }), "Max");
assert.equal(planName({ subscriptionType: "ultra" }), "Ultra");
assert.equal(planName({ subscriptionType: "pro" }), "Pro");
assert.equal(planName({ subscriptionType: "free" }), "Free");
assert.equal(planName({ subscriptionType: "team" }), "Team");
assert.equal(planName({}), null);
assert.equal(planName(undefined), null);

// Shape copied from a real verified Ultra response (2026-10-31).
const limits = [
  { kind: "session", percent: 1, is_active: false },
  { kind: "weekly_all", percent: 64, is_active: true },
];
assert.equal(sessionInactive(limits, "Ultra"), true);
assert.equal(sessionInactive(limits, "Max"), false, "only Ultra drops the 5-hour limit");
assert.equal(sessionInactive([{ kind: "session", is_active: true }], "Ultra"), false, "unverified Ultra");
assert.equal(sessionInactive(undefined, "Ultra"), false);

console.log("claude plan checks passed");
