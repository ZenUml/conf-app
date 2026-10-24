# @zenuml/pr-panel-hub

Local Hub for the GitHub PR Agent Panel, plus `pr-panel-mcp`, the MCP stdio
shim agents launch. Architecture, channels, security and privacy:
[../shared/README.md](../shared/README.md).

```
extension ──ws://127.0.0.1:47391-47394/ (subprotocol zenuml-pr-panel)──▶ Hub
agent ── stdio ── pr-panel-mcp ── <runtime>/hub.sock (NDJSON JSON-RPC) ──▶ Hub
hook script ── one request per lifecycle event ── <runtime>/hub.sock ───▶ Hub
```

## Build, test, run

```bash
pnpm --filter @zenuml/pr-panel-hub build       # dist/cli.mjs (bin) + dist/hub.mjs
pnpm --filter @zenuml/pr-panel-hub test
pnpm --filter @zenuml/pr-panel-hub typecheck

# Hub in the foreground, logs on stderr (Ctrl-C to stop):
node packages/pr-agent-panel/hub/dist/cli.mjs --hub
```

## How agents reach it

- **Claude Code**: the plugin in `../agent-plugin` runs
  `node ${CLAUDE_PLUGIN_ROOT}/../hub/dist/cli.mjs`, so the plugin directory and
  this package must stay siblings and `dist/` must be built.
- **Codex / other MCP clients**: register an stdio server with command `node`
  and argument `<repo>/packages/pr-agent-panel/hub/dist/cli.mjs`.

The shim connects to `<runtime>/hub.sock`. When nothing answers it takes
`start.lock` (leader election between shims started at the same time) and
spawns `dist/hub.mjs` detached; the Hub exits 75 if another Hub already owns
`hub.lock` or the socket, and the shim then uses that Hub. If the Hub
restarts, the shim reconnects; when the agent closes stdin, the shim exits.

**Hub lifetime**: a detached Hub exits 60 s after the last agent (MCP
consumer) disconnects. Extension connections and hook calls do not keep it
alive. A foreground Hub (`--hub`) never idles out unless
`PR_PANEL_IDLE_EXIT_MS` is set.

## Runtime directory

`<os temp>/zenuml-pr-panel/` (0700), or `PR_PANEL_RUNTIME_DIR`:

| Path | Content |
|---|---|
| `hub.sock` | Unix socket, 0600 (Windows: `\\.\pipe\zenuml-pr-panel`) |
| `hub.lock.lock/` | proper-lockfile lock held by the running Hub |
| `start.lock.lock/` | short-lived lock held by the shim that spawns the Hub |
| `hub.json` | `{pid, port, hubVersion, socket, startedAt}` of the running Hub, 0600 |
| `analytics-id` | random Mixpanel `distinct_id`, only when analytics is on |

## Review store

Review runs are kept data, so they live outside the OS temp directory, which the system may clear:
`~/.zenuml-pr-panel/store/reviews/<encoded repoKey>.json`, written atomically, 0600. With
`PR_PANEL_RUNTIME_DIR` set the store is `<runtime dir>/store` instead, so a test Hub never touches
real reviews; `PR_PANEL_STORE_DIR` overrides both.

Before 2026-10-24 the store was `<os temp>/zenuml-pr-panel/store`. On start, a Hub whose store has no
reviews copies them from there once; it never deletes the old copy.

The MCP `delete_review_entry` tool takes an exact `repo` (`host`, `owner`,
`repo`) and `prNumber`. It atomically removes every stored review run for
that PR, returns `{deleted, deletedRuns}`, and broadcasts the replacement
review list to connected extensions. Other PRs, tasks and panel messages are
unchanged. An active task may later publish a new review for the same PR.

The Hub refuses a runtime directory or socket that is a symlink or owned by
another user.

## Environment

| Variable | Effect |
|---|---|
| `PR_PANEL_RUNTIME_DIR` | Runtime directory (shim, Hub and hook script) |
| `PR_PANEL_ALLOWED_EXTENSION_ORIGINS` | Comma-separated exact `chrome-extension://<id>` Origins; empty = any extension Origin |
| `PR_PANEL_MIXPANEL_TOKEN` | Turns on Mixpanel `/track` events (counts, outcomes, durations only) |
| `PR_PANEL_IDLE_EXIT_MS` | Idle exit delay with no agent; `0` = never |
| `PR_PANEL_LOG_LEVEL` | `debug`, `info` (default), `warn`, `error`, `silent` |

## WebSocket admission

127.0.0.1 only; Origin must match `^chrome-extension://[a-p]{32}$` (or the
exact allowlist); path exactly `/` with no query; the client must offer the
`zenuml-pr-panel` subprotocol (a missing header is rejected); at most 4
connections; frames over 1 MiB and binary frames are refused. `GET /` answers
`{service, protocolVersion, hubVersion}`; everything else is 404.

The WebSocket server, Origin policy, shim and hook script are adapted from
TemPad Dev (MIT); see `../THIRD_PARTY_NOTICES.md`.
