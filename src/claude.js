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

  const json = await curlUsage(token.accessToken, platform);
  if (!json) return { ok: false, reason: "unreachable", plan: token.plan };
  if (json.error) {
    const reason = json.error.type === "rate_limit_error" ? "rate-limited" : "error";
    return { ok: false, reason, plan: token.plan };
  }

  const fh = json.five_hour || {};
  const wk = json.seven_day || {};
  return {
    ok: true,
    plan: token.plan,
    fiveHour: pct(fh.utilization) != null ? { pct: pct(fh.utilization), resetsAt: fh.resets_at || null } : null,
    weekly: pct(wk.utilization) != null ? { pct: pct(wk.utilization), resetsAt: wk.resets_at || null } : null,
  };
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
    return { accessToken: oauth.accessToken || null, plan: oauth.subscriptionType || null };
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
  // ponytail: token in argv - a local single-user desktop, same trust boundary
  // as the plaintext credentials file it came from; not worth a temp-config dance.
  const curl = platform === "windows" ? "curl.exe" : "curl";
  const cmd =
    `${curl} -s --max-time 20 ` +
    `-H 'Authorization: Bearer ${accessToken}' ` +
    `-H 'anthropic-beta: oauth-2025-04-20' ` +
    `-H 'Content-Type: application/json' ` +
    `'${USAGE_URL}'`;
  try {
    const out = await ctx.invoke("shell_run_command", { command: cmd, cwd: null, timeoutSecs: 25 });
    const body = String(out?.stdout ?? "").trim();
    if (!body) return null;
    return JSON.parse(body);
  } catch (err) {
    ctx?.logger?.info?.("claude usage curl failed", err);
    return null;
  }
}

function pct(x) {
  return typeof x === "number" && isFinite(x) ? x : null;
}
