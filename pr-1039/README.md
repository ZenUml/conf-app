# PR #1039 evidence: render server first-try failure (#1038)

- **BEFORE:** `168c0cfe` (main, the PR's merge-base).
- **AFTER:** `f4071f45` (PR head).

## 1. OAuth discovery (`oauth/`)

`probe.sh <base> <out>` GETs each discovery path, then POSTs `initialize` to `/agent-link/mcp` with no token.

| File | Target |
|---|---|
| `before-prod.txt` | `https://conf-lite.zenuml.com` (production, BEFORE), 2026-11-03 |
| `before-stg.txt` | `https://conf-stg-lite.zenuml.com` (staging, BEFORE), 2026-11-03 |
| `after-local.txt` | `wrangler pages dev dist` on a `pnpm build:lite` of AFTER, default settings |
| `after-local-flag-off.txt` | the same, with `--binding OAUTH_ROOT_RESOURCE_METADATA=off` |

The local server has no D1/KV, so its `POST /agent-link/mcp` answers 503. The 401's `resource_metadata` is covered by unit tests (`headlessMcp.spec.ts`) and the staging E2E (`agent-link-e2e.spec.ts`).

The same run served `/mcp-app/assets/zenuml-*.js` with `Cache-Control: public, max-age=31536000, immutable`, from `public/_headers`. BEFORE, production served `max-age=14400, must-revalidate`.

## 2. Renderer downloads (`download/`)

`measure.mjs <dist> <out.json> [kbps]` does the following:
- serves `dist/` on one origin and a host page on another;
- plays the MCP Apps host handshake;
- sends `tool-input`, then `tool-result` 50 ms later (the server answers in 20–61 ms per Mixpanel, #1038);
- records every response the view's frame received, with the cache disabled.

Sizes are brotli at quality 4. That matches Cloudflare: the production zenuml chunk is served as 841,382 B, and is 844,687 B at q4. With `kbps`, CDP throttles bandwidth and adds 100 ms latency, and the harness serves brotli.

Fixtures (fictional): a 4-participant login sequence diagram, and a 6-node Mermaid flowchart.

| First diagram | BEFORE | AFTER |
|---|---|---|
| Sequence | 4 files, 803 KB br, 17.3 s at 400 kbps | 4 files, 804 KB br, 17.3 s at 400 kbps |
| Mermaid flowchart | 5 files, 869 KB br, 18.9 s at 400 kbps | 13 files, 204 KB br, 5.2 s at 400 kbps |

Raw data: `before-fast.json`, `before-slow.json`, `after-fast.json`, `after-slow.json`. Screenshots: `*-sequence.png`, `*-mermaid.png`.

**Download failure.** The sequence chunk was deleted from `dist/`:
- BEFORE showed "Could not draw the diagram: Failed to fetch dynamically imported module: …" (`before-fail-sequence.png`);
- AFTER shows "Could not download the diagram renderer. The connection may be slow or blocked; ask again to retry." (`after-fail-sequence.png`).

**File count** (`pnpm build:lite` of AFTER):
- `dist/` holds 4333 files, under Forge's 5000-file resource limit;
- `dist/mcp-app/` holds 70 files, up from 11 BEFORE.

## Limits

- The sequence renderer is unchanged. `@zenuml/core` imports its 1.5 MB `cloud-icons` module statically as well as lazily, so it can't be split from this repo.
- The 400 kbps timings come from a local harness, not a real host or network.
- No check ran in ChatGPT, Codex or Claude.ai for this PR. See the PR's "Not verified" list.
