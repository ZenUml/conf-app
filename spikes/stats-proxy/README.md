# stats-proxy (spike, not for merge)

Cloudflare Worker `zenuml-stats-proxy` on `stats.zenuml.com`. It forwards
session-replay SDK traffic so a Forge macro iframe only talks to `*.zenuml.com`,
which `manifest.yml` already allows. No new egress host, so no major version.

| Path | Upstream |
|---|---|
| `/v1/initialize` | `https://featureassets.org/v1/initialize` (Statsig) |
| `/v1/rgstr` | `https://prodregistryv2.org/v1/rgstr` (Statsig) |
| `/v1/sdk_exception` | `https://statsigapi.net/v1/sdk_exception` (Statsig) |
| `/clarity/collect` | `https://s.clarity.ms/collect` (Microsoft Clarity) |

CORS: echoes allowed origins (`*.cdn.prod.atlassian-dev.net`, `localhost`),
allows any requested `statsig-*` header, and sends
`Access-Control-Allow-Credentials: true` (clarity-js uploads with XHR
`withCredentials`).

Tested 2026-11-19 through `forge tunnel` on a dev site: both vendors received
replays from real macro iframes. Client wiring: `src/utils/analytics/*ReplaySpike.ts`,
enabled only by `VITE_STATSIG_CLIENT_KEY` / `VITE_CLARITY_PROJECT_ID` at Vite start.

Deploy: `wrangler deploy` from this folder.
