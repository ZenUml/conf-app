# Agent container — credentials & reachable systems

What an agent session running in the Claude Code remote container (claude.ai/code,
GitHub Action, or any other CCR entrypoint) can actually reach, and with which
environment variable. Written so an agent does not have to rediscover this by
trial and error at the start of every session.

**Scope:** the remote container only. A developer's laptop is configured
differently (`.env.forge.local`, an interactive `forge login`, a local
`wrangler.toml`) — skills that assume the laptop setup are called out below.

**Never** echo the value of any variable marked *secret*. Test access by making
a call and reporting the status code, not by printing the credential.

---

## Verified working

Each row was confirmed by a live call from inside the container on 2026-08-07.

| System | Env vars | Verified access |
|---|---|---|
| **Confluence REST v2** | `FORGE_EMAIL`, `FORGE_API_TOKEN` *(secret)* | HTTP Basic. `200` on `/wiki/api/v2/spaces` for **all seven** of our sites — see the site table below. |
| **Atlassian Marketplace (vendor reporting)** | `FORGE_EMAIL`, `FORGE_API_TOKEN` *(secret)* | HTTP Basic. `200` on `/rest/2/vendors/1215266/reporting/licenses/export` and `.../reporting/sales/transactions/export`. |
| **Cloudflare** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` *(secret)* | Token valid, expires `2026-12-31`. D1 list **and query**, KV namespace list + key list + value read, Pages project list. |
| **Mixpanel** | `MIXPANEL_SA_USER`, `MIXPANEL_SA_SECRET` *(secret)* | HTTP Basic on `mixpanel.com/api/query/...` for project `3373228`. `MIXPANEL_API_SECRET` *(secret)* also works as a legacy `user:` basic-auth secret. |
| **Confluence browser login** | `ATLASSIAN_USERNAME`, `ATLASSIAN_PASSWORD` *(secret)*, `ATLASSIAN_OTP` *(secret)* | Robot account for **interactive login only** (Playwright). `ATLASSIAN_OTP` is a TOTP *secret*, not a code — generate with `tests/e2e-tests/utils/otp.js`. |
| **GitHub** | — (MCP tools) | `mcp__github__*` tools are authenticated as `whimet`, scoped to `ZenUml/conf-app`. |
| **git over HTTPS** | — (git proxy) | `git fetch` / `git push` to `https://github.com/ZenUml/conf-app` work. SSH remotes are auto-rewritten to HTTPS. |
| **Playwright / Chromium** | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` | Chromium pre-installed. Never run `playwright install`. |

### Sites reachable with `FORGE_EMAIL` + `FORGE_API_TOKEN`

`lite-stg`, `full-stg`, `dia-stg`, `asyncapi-stg`, `zenuml-stg`, `zenuml`,
`whimet4` — all `*.atlassian.net`, all returned `200` with spaces listed.

This is the credential for **every read/write against Confluence content**:
`find-macros-on-page`, `create-test-page`, `download-attachment`, `copy-macro`,
`extend-space-license` verification, `macro-count`.

---

## Present but NOT usable

| Env var | State | Consequence |
|---|---|---|
| `GH_TOKEN`, `GITHUB_TOKEN` | Literal string `proxy-injected` | Direct `api.github.com` calls return a `200` body saying *"GitHub access is not enabled for this session."* **Use the `mcp__github__*` tools instead.** Do not treat the `200` as success — read the body. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Literal `proxy-injected` | No AWS access. We don't use AWS. |
| `CLOUDSDK_AUTH_ACCESS_TOKEN` | Literal `proxy-injected` | No GCP access. |
| `HUBSPOT_PAT` | **Expired.** `401`; token-info endpoint returns `"Access token requires new signature"` | No HubSpot access. The value is a short-lived OAuth access token (`CiRh…` format), not a long-lived private-app PAT. Nothing in this repo references HubSpot, so nothing breaks — but don't plan work around it without re-issuing the token. |

---

## Missing tooling — and the REST substitute

The container has `node` 22, `npm`, `pnpm`, `python3` 3.11 — but **no
`node_modules`, no `forge` CLI, and no `wrangler` CLI**. Several skills document
a CLI path that cannot run here as written:

| Skill / doc | Documented CLI | Substitute in the container |
|---|---|---|
| `forge-installs` | `forge install list` | No substitute — the Forge platform install list has no REST equivalent we use. **This skill cannot run in the container.** Run it on a laptop with `forge login`. |
| `forge-feature-flag` | `forge` CLI | Same limitation for the write path. |
| `paywall`, `extend-space-license`, `test-space-license` | `wrangler kv key put/get` | Cloudflare REST API with `CLOUDFLARE_API_TOKEN`: `…/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/<id>/values/<key>`. |
| any D1 query | `wrangler d1 execute` | `POST …/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/<uuid>/query` with `{"sql": "..."}`. |

Installing a CLI is possible (`npm registry` is in `NO_PROXY`) but costs minutes;
prefer the REST call for a one-off.

### Cloudflare REST gotcha

The KV **key-listing** endpoint rejects `limit` below 10 with
`10028: limit argument must be at least 10`. Use `?limit=10` or higher.

### Marketplace REST gotcha

Only the **`/export`** endpoints under `/rest/2/vendors/{vendorId}/reporting/`
still work. The vendor-less legacy paths and `/rest/2/vendors/me` return
`410 API_DEPRECATED`. `marketplace-audit`'s `mp_report.py` already uses the
export form, so it is unaffected — but a hand-rolled probe against
`/rest/2/vendors/me` will 410 and is **not** evidence that Marketplace access
is broken.

---

## E2E credential name mismatch

The container supplies `ATLASSIAN_USERNAME` / `ATLASSIAN_PASSWORD`, but
`tests/e2e-tests/config/test-config.ts` reads `ZENUML_STAGE_USERNAME` /
`ZENUML_STAGE_PASSWORD`. `ATLASSIAN_OTP` is the one name that matches.

`test-config.ts` now falls back to the `ATLASSIAN_*` names, so `pnpm test:e2e`
and the `smoke-test` skill work in the container with no extra setup. If you see
`Missing username (ZENUML_STAGE_USERNAME)`, you are on a build predating that
fallback — export the mapping for the session:

```bash
export ZENUML_STAGE_USERNAME="$ATLASSIAN_USERNAME"
export ZENUML_STAGE_PASSWORD="$ATLASSIAN_PASSWORD"
```

---

## Egress

All outbound HTTPS goes through the agent proxy at `$HTTPS_PROXY`, which
re-terminates TLS. The CA bundle at `/root/.ccr/ca-bundle.crt` is already wired
into the standard env vars. On a TLS or `403/405/407` failure, read
`/root/.ccr/README.md` and `curl -sS "$HTTPS_PROXY/__agentproxy/status"`.
**Never** disable TLS verification or unset `HTTPS_PROXY`; a `403`/`407` is an
egress-policy denial to report, not to route around.
