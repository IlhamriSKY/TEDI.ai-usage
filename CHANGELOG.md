# Changelog

## 0.1.1

Fixes from a pre-release review.

- **Status-bar icons render again.** They used an `ext-asset:` icon prefix that
  the host does not strip, so both provider glyphs resolved to a missing file
  and showed a blank box. Now bare relative paths (`claude.svg` / `openai.svg`).
- **Claude usage now works on macOS.** Claude Code stores its OAuth credentials
  in the login Keychain there, not in `~/.claude/.credentials.json`, so the
  Claude meter was permanently "Not signed in". Added a Keychain fallback
  (`security find-generic-password -s "Claude Code-credentials"`).
- Tooltip spacing tidied (the host collapses double spaces) and the poll timer
  can no longer be orphaned by a deactivate that races the first refresh.

## 0.1.0

Initial release.

- Two status-bar meters: **Claude Code** and **Codex (ChatGPT)** usage, each a
  provider glyph + percentage + a severity-coloured progress bar.
- Hover tooltip breaks out the 5-hour and weekly/monthly windows with a reset
  countdown, plus the plan name and (for Codex) how fresh the snapshot is.
- Claude data via the OAuth usage endpoint (`five_hour` / `seven_day`); Codex
  data from the newest local rollout session's `rate_limits`.
- 60-second refresh; muted `—` when a provider is signed out or has no data.
- Requires TEDI's status-bar progress-bar support (`label` / `progress` on a
  status item).
