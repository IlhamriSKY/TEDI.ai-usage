# Changelog

## 0.1.8

### Added

- **Click a meter to refresh it now.** Each meter is a real focusable button rather than a decorative icon, so a click polls immediately instead of waiting out the rest of the five-minute interval, and the tooltip says "Click to refresh" (or "Refreshing…" while one is in flight). A manual refresh deliberately ignores the Claude 429 back-off: you asked for fresh numbers, and if the endpoint is still throttling, the same answer re-arms the cooldown. A second click while a poll is running is ignored rather than queued.

### Changed

- `kind: "status"` is now declared explicitly on both meters. The host infers "action" from a bare icon plus a click handler, which would have moved a meter into the buttons group for exactly as long as its data was missing — so the inference is right for a button and wrong for a readout that happens to be clickable.
- `engines.tedi` raised to `>=0.4.7`, the release that added `StatusItem.kind`. `onClick` alone landed in 0.3.92, but without `kind` the meters would drift between status-bar groups on 0.3.92–0.4.6.

### Removed

- The `ui:toast` permission. Nothing used it, and a permission you do not need is one the install review should not be asking anyone to approve.

## 0.1.7

### Changed

- **Built against TEDI's published extension types.** TEDI 0.4.26 ships `tedi.d.ts`, a standalone typed contract for `ctx`, and a JSON Schema for `manifest.json`. Both now live in this repo, written by `tedi ext types`, alongside a `jsconfig.json` that turns type checking on for plain JavaScript. A misspelled `ctx.*` call is an editor error now rather than a `TypeError` raised inside an async handler, where it surfaces as an unhandled rejection nobody sees. `build.mjs` is the canonical copy shared across the TEDI extensions: it reads its entry point, output path and banner from `manifest.json`, so it holds nothing specific to this extension. The manifest gains a `$schema` line, which every parser ignores and which gives the file completion while it is edited. No behaviour changes; the bundle esbuild produces is byte-identical apart from its banner comment.

## 0.1.6

Resilience for Anthropic's rate-limited usage endpoint (a known Claude Code
issue: the `/api/oauth/usage` endpoint 429s aggressively even at 30-60s and
often omits `Retry-After`).

- Poll every **5 minutes** instead of 60 seconds (matches the community tools).
- Detect the 429 by HTTP status and **back off** (respect `Retry-After` when
  present, else 15 minutes) so we stop hammering and prolonging the throttle.
- **Keep showing the last known percentages** (marked "last known") during a
  rate-limit instead of blanking; restore them from storage across restarts.

## 0.1.5

- **Signed-in account shown in Settings.** Each provider now has a read-only
  account row in the Settings card (`claude02@example.com (Max)`,
  `you@example.com (ChatGPT Go)`) above its show/hide switch. The value is read
  locally and synced to the Settings window through the store, backed by a new
  read-only `note` setting type in the host and the `settings:write` permission.
  A separate Settings window only renders manifest-declared settings, so the
  earlier runtime-only account label never appeared there; this fixes that.

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
