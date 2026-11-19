# Independent public render MCP deployment

The public diagram server and its MCP Apps view have their own Cloudflare Worker deployment. They reuse this repository's renderer and JSON-RPC implementation; deploying them does not build or deploy a Forge variant or the Confluence Pages backend.

| Surface | Runtime |
| --- | --- |
| `https://zenuml.com/mcp` | Public render Worker |
| `https://conf-lite.zenuml.com/mcp` and `/mcp/render` | Same Worker; retained aliases |
| `https://zenuml.com/mcp-app/*` and `/drawio/*` | Assets bundled with the public Worker |
| `https://conf-lite.zenuml.com/mcp-app/*` | Existing Pages assets, retained for authenticated Confluence MCP clients |
| `/agent-link/mcp` | Existing authenticated Confluence integration; not part of this deployment |

This table describes the configured deployment. Confirm the live cutover with the health and protocol checks below; a merged PR alone is not production evidence.

## Build and preview

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run workers/render-mcp/index.spec.ts functions/agent-link/renderMcp.spec.ts functions/agent-link/renderRateLimit.spec.ts
node workers/render-mcp/build.mjs
pnpm exec wrangler deploy --config workers/render-mcp/wrangler.toml --env preview --dry-run
```

The build invokes the existing MCP Vite configuration with a separate output directory. It copies the static DrawIO viewer and its fonts, images, stencils and MathJax files; it does not copy the Confluence SPA or run a variant build. `workers/render-mcp/dist/` is disposable output. The build records the checked-out commit, dirty status, build time and view HTML digest.

The independent `Render MCP Worker` workflow builds and tests changes, then deploys trusted branch/PR candidates to `zenuml-render-mcp-preview.zenuml.workers.dev`. Fork PRs receive checks without deployment credentials. The preview has no production routes and no Mixpanel tracking token. A shared preview can be replaced by another branch, so always check its health commit before testing.

## Production

Use the independent workflow's manual production dispatch from `main`, with its exact source SHA. The workflow applies only the dedicated rate-counter migration, uploads this Worker and its tested assets with `wrangler versions upload`, then activates that exact returned version with `wrangler versions deploy <version-id>@100% --yes`. It never publishes production routes. Preview keeps its existing `wrangler deploy` path.

The workflow reads the upload's structured JSONL output, requires one valid version ID for the production Worker/environment, and stops before activation if the upload fails or its identity is ambiguous. It preserves the version ID and uploaded/deployed stage in `render-mcp-deployment.json`. After activation it waits up to 120 seconds for health to report the exact clean source. This wait only checks deployment readiness and rejects redirects. It then runs the protocol, render and asset smoke checks once, across all three production endpoints. Standard JavaScript/XML MIME equivalents are accepted; unexpected types, HTML fallbacks, wrong hashes and missing CORS still fail. No `FORGE_API_TOKEN`, Forge app ID, Confluence account or variant release is involved.

Cloudflare versions include code, static assets and bindings; route publication is a separate trigger operation. This path is supported by the lockfile's Wrangler 4.60.0, including `WRANGLER_OUTPUT_FILE_PATH` records of type `version-upload`. Do not add Workers Routes permission to the CI token for ordinary releases. See [versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) and [Wrangler version/trigger commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-upload).

Before initial deployment, provision separate preview and production D1 databases and Worker secrets. `wrangler.toml` records the database IDs. Each database contains only `McpRenderRate` counters. Set `OAUTH_GRANT_SECRET` separately on each Worker to retain HMAC address buckets; this historical binding name does not enable OAuth. Production also needs `MIXPANEL_TOKEN`, the existing project's tracking token. Secrets are supplied through stdin and are never committed. Ordinary deployments preserve them. The workflow checks required secret names before deployment.

Existing render analytics events and their properties remain unchanged. This deployment split adds no new user action or analytics event. Preview sends no production telemetry. Neither the Worker nor its rate database stores diagram source. The view draws PlantUML in the browser with its bundled engine and makes no requests to the PlantUML service. It has no fallback: a diagram the engine cannot draw, such as one using an `!include` library that is not hosted, shows an error in the view.

Production canonicalizes all public aliases to `https://zenuml.com` for UI resource URLs and CSP. `resources/read` retrieves the view through the Worker's asset binding, without a Pages self-fetch. Missing assets return errors rather than a successful SPA page. API and health responses are not cached. Only hashed renderer chunks receive immutable cache headers.

The route patterns end in `*` to include query strings. The Worker dispatches exact MCP paths; unrelated matching paths on the two production hosts fall through to their original Pages origin. In particular, the old host's authenticated MCP view assets remain with Pages. Preview has no backing website and answers unrelated paths with 404. Unknown hosts are rejected.

### Route bootstrap and readiness

An administrator uses the existing local Cloudflare OAuth session to register only these three production routes for `zenuml-render-mcp`. Keep this one-time operation and any later route changes separate from routine CI releases; the CI token does not need zone route permissions.

| Route | Worker |
| --- | --- |
| `https://zenuml.com/mcp*` | `zenuml-render-mcp` |
| `https://zenuml.com/drawio/*` | `zenuml-render-mcp` |
| `https://conf-lite.zenuml.com/mcp*` | `zenuml-render-mcp` |

Record the route mapping before and after the administrator's change. Then check both exact `/mcp/health` URLs, the same expected source SHA and `dirty: false`, followed by all three endpoint smoke checks. A successful version upload or activation does not prove these routes exist. A failed full `wrangler deploy` can already have uploaded the Worker and assets before route publication fails; preserve the failed run and inspect the live state instead of assuming rollback or CI success. Routine version commands leave route and other non-versioned trigger/settings changes to the separate administrator operation.

## Acceptance and release evidence

```sh
node scripts/ci/check-render-mcp.mjs --help
curl --fail https://zenuml.com/mcp/health
```

Retain the workflow run, Worker version/deployment ID, source SHA and smoke artifact. Confirm `dirty: false`, the expected commit, matching HTML/CSP across the canonical and legacy endpoints, and successful JavaScript/CSS/font requests. Protocol checks do not establish that a host mounted the UI.

Next use a fresh real ChatGPT connection at the canonical URL with **Enforce CSP for custom apps enabled**. Observe first load through final host idle and retain actual Console/Network evidence, including the sandboxed view. Verify the supported diagram cases, hosted fonts and wide-diagram scrolling. Treat automation-driver errors separately from product failures; do not count a retry as proof of a first-load fix. Record the narrated review video only after that acceptance passes.

The Confluence Storybook → Forge Tunnel → staging UI sequence is not applicable to this deployment-only split: it changes no Confluence UI. Actual MCP host validation remains required. OpenAI app submission is a separate action; this workflow never submits or publishes a plugin.

## Rollback

Keep the previous Worker deployment/version IDs before a production update. Roll back the Worker using Cloudflare deployment history, then repeat the endpoint and host checks. For the initial cutover, the underlying Pages MCP endpoints and the website's proxy remain intact: removing only this Worker's three configured routes restores that previous service. Do not delete Pages code, old addresses, rate databases or secrets as part of cutover. The dedicated counter schema is additive and carries no diagram data.
