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

Use the independent workflow's manual production dispatch from `main`, with its exact source SHA. The workflow applies only the dedicated rate-counter migration, deploys this Worker and its assets, and verifies the live health SHA and all three endpoint responses. No `FORGE_API_TOKEN`, Forge app ID, Confluence account or variant release is involved.

Before initial deployment, provision separate preview and production D1 databases and Worker secrets. `wrangler.toml` records the database IDs. Each database contains only `McpRenderRate` counters. Set `OAUTH_GRANT_SECRET` separately on each Worker to retain HMAC address buckets; this historical binding name does not enable OAuth. Production also needs `MIXPANEL_TOKEN`, the existing project's tracking token. Secrets are supplied through stdin and are never committed. Ordinary deployments preserve them. The workflow checks required secret names before deployment.

Existing render analytics events and their properties remain unchanged. This deployment split adds no new user action or analytics event. Preview sends no production telemetry. Neither the Worker nor its rate database stores diagram source. The view still requests PlantUML images from the disclosed PlantUML service.

Production canonicalizes all public aliases to `https://zenuml.com` for UI resource URLs and CSP. `resources/read` retrieves the view through the Worker's asset binding, without a Pages self-fetch. Missing assets return errors rather than a successful SPA page. API and health responses are not cached. Only hashed renderer chunks receive immutable cache headers.

The route patterns end in `*` to include query strings. The Worker dispatches exact MCP paths; unrelated matching paths on the two production hosts fall through to their original Pages origin. In particular, the old host's authenticated MCP view assets remain with Pages. Preview has no backing website and answers unrelated paths with 404. Unknown hosts are rejected.

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
