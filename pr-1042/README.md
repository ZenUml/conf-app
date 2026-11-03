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
