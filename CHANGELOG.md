# Changelog

## 0.1.4

- **Signed-in account in Settings.** Each provider's show/hide switch is now
  labelled with the account and plan it reads, for example
  `Signed in: you@example.com (Max)` and `Signed in: you@example.com (ChatGPT Go)`.
  Claude from `~/.claude.json`, Codex from the `~/.codex/auth.json` id_token.
- The two switches are declared in the manifest (`contributes.settings`) so the
  card shows even before the extension finishes loading, matching the other TEDI
  extensions.
- A missing `settings:read` permission no longer blocks the meters; they fall
  back to showing both.
- **Pixel-style bars** (host render): the pill and the tooltip windows draw as
  blocky segments. Amber means about to run out, red means spent, so the colour
  is an at-a-glance indicator.

## 0.1.3

- **Real progress bars in the tooltip.** Each window now renders as a graphical
  themed bar (not ASCII blocks), with its percent and reset countdown. Backed by
  a new optional `detail` field on the host status-bar item.
- Project links now point to the TEDI website, <https://tedi.ilhamriski.com/>.
- README tidied to match the layout of the other TEDI extensions.

## 0.1.2

- **Claude logo.** The Claude meter now uses the Claude mark instead of the
  Anthropic wordmark.
- **Progress bars in the tooltip.** Each window in the hover tooltip is drawn as
  its own bar, for example `5-hour ██░░░░░░░░ 8% resets in 3h 9m`.
- **Show/hide each meter.** Two switches in the extension's Settings card toggle
  the Claude and Codex meters independently.
- An unavailable provider now shows just a dimmed icon (no placeholder glyph),
  and the wording drops em dashes.

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
- 60-second refresh; a dimmed icon when a provider is signed out or has no data.
- Requires TEDI's status-bar progress-bar support (`label` / `progress` on a
  status item).
