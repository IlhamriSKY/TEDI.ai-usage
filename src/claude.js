// Claude Code usage. Reads the local OAuth token from
// `~/.claude/.credentials.json` and asks Anthropic's undocumented,
// community-discovered usage endpoint for the same numbers `/usage` shows:
// the 5-hour rolling window and the 7-day window, each a utilization percent
// plus a reset timestamp. Returns `{ ok:false, reason }` on any failure so the
// meter degrades quietly.

import { ctx } from "./runtime.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export async function readClaudeUsage(home, platform) {
  const token = await readToken(home, platform);
  if (!token.accessToken) return { ok: false, reason: token.reason || "not-signed-in" };

  const { status, retryAfter, json } = await curlUsage(token.accessToken, platform);
  // The endpoint 429s aggressively (a known Claude Code issue) and often omits
  // Retry-After. Surface it so the caller can back off and keep the last value.
  if (status === 429 || json?.error?.type === "rate_limit_error") {
    return { ok: false, reason: "rate-limited", plan: token.plan, retryAfterSec: retryAfter };
  }
  if (!json) return { ok: false, reason: "unreachable", plan: token.plan };
  if (json.error) return { ok: false, reason: "error", plan: token.plan };

  const fh = json.five_hour || {};
  const wk = json.seven_day || {};
  return {
    ok: true,
    plan: token.plan,
    // A verified Ultra account still gets a `five_hour` reading, but its
    // `limits[]` session entry says `is_active: false`: the window is counted,
    // not enforced (claude.ai Settings > Usage then shows no session bar).
    noFiveHourLimit: sessionInactive(json.limits, token.plan),
    fiveHour: pct(fh.utilization) != null ? { pct: pct(fh.utilization), resetsAt: fh.resets_at || null } : null,
    weekly: pct(wk.utilization) != null ? { pct: pct(wk.utilization), resetsAt: wk.resets_at || null } : null,
    models: modelLimits(json.limits),
  };
}

// shortcut: `is_active` is undocumented and Fable reads false too while still
// capped, so it is trusted only for the session limit on Ultra, the one plan
// documented to drop it; widen it if other plans start reporting it.
export function sessionInactive(limits, plan) {
  if (plan !== "Ultra" || !Array.isArray(limits)) return false;
  return limits.some((l) => l?.kind === "session" && l.is_active === false);
}

// Per-model weekly caps (e.g. Fable), from the `limits` array. The top-level
// fields carry them only under codenames (`nimbus_quill`), while `limits` names
// the model, so a new scoped model shows up without a code change.
function modelLimits(limits) {
  if (!Array.isArray(limits)) return [];
  return limits
    .filter((l) => l?.kind === "weekly_scoped" && l.scope?.model?.display_name && pct(l.percent) != null)
    .map((l) => ({ name: l.scope.model.display_name, pct: l.percent, resetsAt: l.resets_at || null }));
}

async function readToken(home, platform) {
  // Linux / Windows: Claude Code writes a plaintext ~/.claude/.credentials.json.
  const fromFile = await tokenFromFile(home);
  if (fromFile.accessToken) return fromFile;
  // macOS: the same JSON lives in the login Keychain instead (the file is
  // usually absent), so fall back to `security find-generic-password`. Uses the
  // already-granted shell permission; may prompt for Keychain access once.
  if (platform === "macos") {
    const fromKeychain = await tokenFromKeychain();
    if (fromKeychain.accessToken) return fromKeychain;
  }
  return { reason: "not-signed-in" };
}

async function tokenFromFile(home) {
  try {
    const res = await ctx.invoke("fs_read_file", { path: `${home}/.claude/.credentials.json` });
    if (res?.kind === "text" && res.content) return parseCreds(res.content);
  } catch {
    // absent / unreadable -> caller tries the next source
  }
  return {};
}

async function tokenFromKeychain() {
  try {
    const out = await ctx.invoke("shell_run_command", {
      command: "security find-generic-password -s 'Claude Code-credentials' -w",
      cwd: null,
      timeoutSecs: 10,
    });
    const body = String(out?.stdout ?? "").trim();
    if (body) return parseCreds(body);
  } catch (err) {
    ctx?.logger?.info?.("claude keychain read failed", err);
  }
  return {};
}

function parseCreds(text) {
  try {
    const oauth = JSON.parse(text)?.claudeAiOauth || {};
    return { accessToken: oauth.accessToken || null, plan: planName(oauth) };
  } catch {
    return {};
  }
}

// WebView2 / WKWebView enforce CORS on remote-origin `fetch`, and the custom
// `anthropic-beta` header forces a preflight the endpoint won't answer - so the
// GET is routed through curl on the native side instead of `fetch`.
async function curlUsage(accessToken, platform) {
  // PowerShell aliases bare `curl` to Invoke-WebRequest, so call `curl.exe` on
  // Windows; every supported OS ships a real curl. Single-quoted args are
  // literal in both PowerShell and POSIX sh, so no `$`/space expansion bites us.
  // `-D -` dumps the response headers to stdout (for the status + Retry-After),
  // then the body, then a trailing `HTTPSTATUS:<code>` from `-w`.
  // Known limit: token in argv - a local single-user desktop, same trust boundary
  // as the plaintext credentials file it came from; not worth a temp-config dance.
  const curl = platform === "windows" ? "curl.exe" : "curl";
  const cmd =
    `${curl} -s -D - -w '\\nHTTPSTATUS:%{http_code}' --max-time 20 ` +
    `-H 'Authorization: Bearer ${accessToken}' ` +
    `-H 'anthropic-beta: oauth-2025-04-20' ` +
    `-H 'Content-Type: application/json' ` +
    `'${USAGE_URL}'`;
  try {
    const out = await ctx.invoke("shell_run_command", { command: cmd, cwd: null, timeoutSecs: 25 });
    return parseHttp(String(out?.stdout ?? ""));
  } catch (err) {
    ctx?.logger?.info?.("claude usage curl failed", err);
    return { status: 0, retryAfter: null, json: null };
  }
}

// Split curl's `-D - ... -w HTTPSTATUS:<code>` output into { status, retryAfter,
// json }. Headers precede the body (first blank line separates them); the
// status line is appended last.
function parseHttp(raw) {
  let status = 0;
  const sm = raw.match(/\r?\nHTTPSTATUS:(\d+)\s*$/);
  if (sm) {
    status = Number(sm[1]);
    raw = raw.slice(0, sm.index);
  }
  const sep = raw.search(/\r?\n\r?\n/);
  const head = sep >= 0 ? raw.slice(0, sep) : "";
  const bodyText = (sep >= 0 ? raw.slice(sep) : raw).trim();
  const ra = head.match(/^retry-after:\s*(\d+)/im);
  const retryAfter = ra ? Number(ra[1]) : null;
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    /* non-JSON body (e.g. an HTML error page) */
  }
  return { status, retryAfter, json };
}

/**
 * The plan's current name from the credentials' `claudeAiOauth`. Anthropic
 * renamed Max 20x to Ultra (2026-10-30) without touching existing logins: they
 * still say `subscriptionType: "max"`, and only `rateLimitTier`
 * (`default_claude_max_20x` vs `_5x`) tells the two apart. Ultra has no 5-hour
 * limit once verified, so the name decides how a missing 5-hour window reads.
 */
export function planName(oauth) {
  const type = String(oauth?.subscriptionType || "").toLowerCase();
  const tier = String(oauth?.rateLimitTier || "").toLowerCase();
  if (type === "ultra" || tier.includes("ultra") || tier.includes("20x")) return "Ultra";
  if (type === "max") return "Max";
  if (type === "pro") return "Pro";
  if (type === "free") return "Free";
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : null;
}

function pct(x) {
  return typeof x === "number" && isFinite(x) ? x : null;
}
