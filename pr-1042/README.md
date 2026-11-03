# PR #1042 evidence: path-based OAuth issuer (#1038)

- **BEFORE:** `c5d13e68`, `main` (v2026.11.031958-diagramly and -lite on production).
- **AFTER:** `6cbf69d2`, the PR head.

`table.sh <base> <out>` requests every discovery URL and records its status, content type and key field (`issuer`, `authorization_servers` or `error`). It then requests a missing and an existing `/mcp-app/assets/` file.

| File | What |
|---|---|
| `before-prod.txt` | `https://conf-lite.zenuml.com`, 2026-11-03 |
| `before-stg.txt` | `https://conf-stg-lite.zenuml.com` (staging, `OAUTH_ROOT_RESOURCE_METADATA=off`), 2026-11-03 |
| `local-default.txt` | `wrangler pages dev dist` on a `pnpm build:lite` of AFTER, no flags (= production after a release) |
| `local-off.txt` | same, `--binding OAUTH_ROOT_AS_METADATA=off --binding OAUTH_ROOT_RESOURCE_METADATA=off` (= staging after this PR) |

**Limitation:** the local server has no D1/KV, so the authorize, token and refresh flows are covered by unit tests (`authServer.spec.ts`), not here. The staging results with a real Codex client are added to the PR once this branch is deployed.

## Staging, after this PR's deploy (2026-11-03)

- `after-stg.txt`: `table.sh` against `conf-stg-lite`, with both flags off, as `wrangler-stg.toml` now sets them.
- **Codex CLI 0.166.0** (npm), fresh `CODEX_HOME` each run, `BROWSER=true`, no TTY:
  - `codex-before-add.txt`: `codex mcp add zenuml-render --url https://conf-stg-lite.zenuml.com/mcp/render` against staging *before* the deploy. It printed "Detected OAuth support. Starting OAuth flow…" and an authorize URL with `resource=…/mcp/render`, then waited. Query values are redacted.
  - `codex-after-add-mcp-render.txt` and `codex-after-add-mcp.txt`: the same command for `/mcp/render` and `/mcp` *after* the deploy. Each printed "Added global MCP server" and exited 0, with no OAuth flow.
  - `codex mcp list` showed Auth `Unsupported` for both, which is Codex's label for a server with no OAuth.
- `after-stg-missing-assets.txt`: a fresh missing path returns 404 with `cache-control: no-store`. `/mcp-app/assets/does-not-exist.js` still returns a 200 `cf-cache-status: HIT`. That is the edge's copy of the old SPA answer, cached by an earlier probe under the year-long header that this PR stops sending.
