// Shared runtime state for the AI Usage Meter. esbuild preserves ESM live
// bindings across the bundle, so the other modules read `ctx`/`state` live and
// mutate through the setters here (mirrors the discord/sql-explorer pattern).
// Keep this the ONE owner of the state so no module duplicates it.

export let ctx = null;
export function setCtx(value) {
  ctx = value;
}

export const state = {
  /** Latched false on deactivate so late async work becomes a no-op. */
  active: false,
  /** Absolute home dir, resolved once via `echo $HOME`. */
  home: null,
  /** Poll interval handle. */
  timer: null,
  /** Per-meter visibility, driven by the contributed settings. */
  showClaude: true,
  showCodex: true,
  /** Last usage result per provider, so a settings toggle can re-render the
   *  meter immediately without waiting for the next poll. */
  lastClaude: null,
  lastCodex: null,
};

export function clearTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

// `echo $HOME` prints the home dir in BOTH POSIX sh (`-lc`) and PowerShell
// (`-Command`) - the two shells `shell_run_command` uses. On the rare cmd.exe
// fallback `$HOME` stays literal, which we detect and treat as "no home".
// ponytail: cmd.exe fallback yields no home; the meters simply never appear.
export async function resolveHome() {
  if (state.home) return state.home;
  try {
    const out = await ctx.invoke("shell_run_command", {
      command: "echo $HOME",
      cwd: null,
      timeoutSecs: 10,
    });
    const first = String(out?.stdout ?? "")
      .split(/\r?\n/)[0]
      .trim();
    if (first && !first.includes("$HOME")) {
      state.home = first.replace(/[\\/]+$/, "");
    }
  } catch (err) {
    ctx?.logger?.warn?.("home resolve failed", err);
  }
  return state.home;
}
