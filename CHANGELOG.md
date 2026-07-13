# Changelog

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
