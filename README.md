# TEDI AI Usage Meter

Shows your [Claude Code](https://claude.com/claude-code) and
[Codex](https://openai.com/codex) (ChatGPT) usage right in the
[TEDI](https://github.com/IlhamriSKY/TEDI) status bar: a small provider glyph, a
percentage, and a progress bar that turns amber then red as you approach a
limit. Hover either meter for the full breakdown, the 5-hour rolling window and
the weekly (or monthly) window, each drawn as a bar with a reset countdown.

<p align="center">
  <img src="logo.png" alt="AI Usage Meter" width="96" />
</p>

Two meters appear at the bottom-right, next to your other status-bar extensions:

```
  claude 8% ██░░░░░░░░   openai 6% █░░░░░░░░░
```

Hover for the detail (each window as its own bar):

```
Claude Code (Max)
5-hour ██░░░░░░░░ 8% resets in 3h 9m
Weekly ████░░░░░░ 41% resets in 3h 39m
```

Each meter can be hidden individually from **Settings, Extensions, AI Usage
Meter** (two switches: show the Claude meter, show the Codex meter).

---

## How it works

Everything is read from the CLIs you already have installed. Nothing is written,
and the only network call is to Claude's own usage endpoint.

| Provider | Source |
| --- | --- |
| **Claude Code** | Reads the OAuth token from `~/.claude/.credentials.json`, then GETs `https://api.anthropic.com/api/oauth/usage` (the same numbers `/usage` shows: `five_hour` + `seven_day` utilization and reset times). The request is routed through `curl` because the app webview blocks a direct cross-origin `fetch`. |
| **Codex** | Reads the newest `~/.codex/sessions/**/rollout-*.jsonl` and pulls the last `token_count` event's `rate_limits` (the `primary` / `secondary` windows). Codex only writes these once it makes an API call, so the meter shows the last known snapshot with an "as of …" note. Window sizes are labelled by their reported duration (5-hour / weekly / monthly / …). |

The meter refreshes every 60 seconds. A provider you're not signed into (or
haven't used) shows just a dimmed icon; hover it to see why.

## Install

Grab the `.zip` from [Releases](https://github.com/IlhamriSKY/TEDI.ai-usage/releases/latest),
then in TEDI: **Settings → Extensions → From file**, review the permissions, and
click **Install**. Enable it and the meters appear.

## Permissions

| Permission | Why |
| --- | --- |
| `statusbar:write` | Draw the two meters. |
| `invoke:fs_read_file` | Read `~/.claude/.credentials.json` and the Codex rollout files. |
| `invoke:fs_glob` | Find the newest Codex session file. |
| `invoke:shell_run_command` | Resolve your home directory and run `curl` for Claude's usage endpoint. |
| `ui:toast` | Surface the occasional error. |

`invoke:shell_run_command` and `invoke:fs_read_file` are flagged high-risk in the
install dialog because they can, in general, run commands and read files. This
extension uses them only for the two purposes above; the source is in `src/`.

## Privacy

- No telemetry, no analytics, no third-party servers.
- Your Claude OAuth token never leaves your machine except as the `Authorization`
  header on the request to `api.anthropic.com` (Anthropic's own endpoint).
- Codex data is read from local files and never sent anywhere.

## Development

The shipped artifact is a single bundled `extension.js`. Source lives in `src/`.

```bash
npm install
npm run build      # src/ -> extension.js
npm run watch      # rebuild on change
```

To iterate inside a TEDI checkout, drop this folder under `extensions/<id>/` and
run `pnpm tauri:dev:ext`, then reload the window (Ctrl+R) after each build.

## License

[Apache-2.0](LICENSE) © IlhamRiski
