// Which account is signed in per provider, for the Settings card. All local
// file reads, no network.
//   Claude: email from ~/.claude.json (oauthAccount), plan from the credentials.
//   Codex:  email + plan decoded from the id_token JWT in ~/.codex/auth.json.

import { ctx } from "./runtime.js";

export async function readClaudeAccount(home) {
  let email = null;
  let plan = null;
  try {
    const cred = await ctx.invoke("fs_read_file", { path: `${home}/.claude/.credentials.json` });
    if (cred?.kind === "text") plan = JSON.parse(cred.content)?.claudeAiOauth?.subscriptionType || null;
  } catch {
    /* not signed in */
  }
  try {
    const cfg = await ctx.invoke("fs_read_file", { path: `${home}/.claude.json` });
    if (cfg?.kind === "text") email = JSON.parse(cfg.content)?.oauthAccount?.emailAddress || null;
  } catch {
    /* email unavailable (missing or too large) */
  }
  return { email, plan, signedIn: !!(email || plan) };
}

export async function readCodexAccount(home) {
  try {
    const res = await ctx.invoke("fs_read_file", { path: `${home}/.codex/auth.json` });
    if (res?.kind !== "text" || !res.content) return { signedIn: false };
    const token = JSON.parse(res.content)?.tokens?.id_token;
    if (!token) return { signedIn: false };
    const payload = decodeJwt(token);
    const email = payload?.email || null;
    const plan = payload?.["https://api.openai.com/auth"]?.chatgpt_plan_type || null;
    return { email, plan, signedIn: !!email };
  } catch {
    return { signedIn: false };
  }
}

// Decode a JWT payload (base64url -> JSON), UTF-8 safe. `atob` is available in
// the extension's webview.
function decodeJwt(jwt) {
  const seg = jwt.split(".")[1];
  if (!seg) return null;
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const json = decodeURIComponent(
    bin
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join(""),
  );
  return JSON.parse(json);
}
