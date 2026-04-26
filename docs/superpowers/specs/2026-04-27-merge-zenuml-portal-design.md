# Merge zenuml-portal into conf-app — Design

**Date:** 2026-04-27
**Status:** Approved
**Goal:** Reduce operational complexity by retiring the standalone `zenuml-portal` Cloudflare Worker. Fold its two endpoints into conf-app and host them on each variant's own backend.

## Current state

### zenuml-portal (separate Worker)
- Repo: `~/workspaces/zenuml/zenuml-portal`
- Stack: Hono on Cloudflare Workers
- Hosted at: `portal.zenuml.com` (prod), `portal-stg.zenuml.com` (stg)
- Endpoints:
  - `GET /feature-flags?client=<domain>&features=A,B,C` — looks up client domain in `KV_FEATURE_FLAGS`, returns `{ A: bool, B: bool, ... }`
  - `POST /ai-generate-title` — calls Workers AI binding, returns a generated title
- Bindings:
  - `KV_FEATURE_FLAGS` prod: `fe9042cb20994651b0a2ef9e68f9037c`
  - `KV_FEATURE_FLAGS` stg: `fd87eed34f864190880a4b44d25c0e91`
  - `AI` (Workers AI)

### conf-app (Cloudflare Pages, three variants)
- Repo: `~/workspaces/zenuml/conf-app`
- Pages projects: separate per variant (lite, full, diagramly) plus dev/stg projects
- Already has `functions/` (Pages Functions), D1, R2, multiple KV bindings, Wrangler-driven CI/CD
- The only callers of zenuml-portal:
  - `src/apis/portalDomain.ts` — picks portal host by Forge environment
  - `src/apis/featureFlags.ts` — fetches `${portal}/feature-flags?client=...&features=...`

## Decision

**Each variant's backend hosts the portal endpoints on its own domain.** No shared `portal.zenuml.com` after cutover.

Considered and rejected:
- Custom domain `portal.zenuml.com` on one Pages project — couples all variants to one project's lifecycle.
- Dedicated 4th Pages project for portal — preserves a service boundary we no longer need.
- Ship code to all three variants but keep one custom domain — gets the worst of both: still one shared domain, plus dead code in two variants.

The chosen approach genuinely reduces ops surface (4 services → 3 services), removes cross-variant coupling, and requires only one frontend code change.

## Target architecture

```
Forge Custom UI (any variant)
  └── src/apis/featureFlags.ts
        └── GET ${forgeGlobal.zenumlRemoteBaseUrl}/feature-flags?client=...&features=...
              └── conf-app Pages Function: functions/feature-flags.ts
                    └── KV_FEATURE_FLAGS  ← bound on each variant Pages project (same namespace ID)
```

Same shape for `POST /ai-generate-title`.

KV is an account-level resource. Binding the same namespace ID from multiple Pages projects is valid and the data is shared (same pattern as `SPACE_LICENSE_KV` today).

## Components

### 1. New Pages Functions

```
functions/feature-flags.ts        # GET — port of zenuml-portal/src/functions/featureFlags.ts
functions/ai-generate-title.ts    # POST — port of zenuml-portal/src/functions/aiGenerateTitle.ts
```

Logic copied verbatim. Only the framework wrapper changes:
- Hono `(c) => c.json(...)` → Pages `onRequestGet({ request, env }) => Response.json(...)`
- Validators inlined (Hono's `zValidator` has no Pages equivalent — straight checks against query/body).

The host check inside the handlers is **not needed** — these endpoints are reachable on each variant's own host (`conf-lite.zenuml.com`, `conf-full.zenuml.com`, `conf-dia.zenuml.com`, plus their `-stg` counterparts) and exposing them there is the design.

### 2. Tests
- Port `functions/featureFlags.spec.ts` to Vitest (conf-app's existing test framework). Logic is unchanged; only the test wrapper changes.
- New unit test for `ai-generate-title.ts` if the original lacks one.

### 3. Wrangler config

Add to **all** conf-app wrangler files (`wrangler.toml`, `wrangler-dev.toml`, `wrangler-stg.toml`, `wrangler-prod.toml`) using the existing scoping pattern:

```toml
# Default / dev / stg envs — use the staging KV
[[ kv_namespaces ]]
binding = "KV_FEATURE_FLAGS"
id = "fd87eed34f864190880a4b44d25c0e91"

# Prod env — production KV
[[ env.production.kv_namespaces ]]
binding = "KV_FEATURE_FLAGS"
id = "fe9042cb20994651b0a2ef9e68f9037c"

# Workers AI — same binding works in all envs
[ai]
binding = "AI"
```

KV IDs are reused as-is. **No data migration.**

### 4. Frontend caller change

`src/apis/portalDomain.ts` becomes one line:

```ts
import forgeGlobal from '@/model/globals/forgeGlobal';

export function getPortalDomain() {
  return forgeGlobal.zenumlRemoteBaseUrl;
}
```

The `featureFlags.ts` fetch URL stays as `${portal}/feature-flags?...` — `portal` now resolves to the variant's own backend (e.g. `https://conf-lite.zenuml.com`).

Update `src/model/ApWrapper2.spec.ts` if it relies on `portalDomain` mocks.

## Cutover plan

1. **Land code change** — endpoints + wrangler bindings on a feature branch. CI deploys to stg variants.
2. **Smoke test on staging** — verify `https://conf-lite-stg.zenuml.com/feature-flags?client=foo&features=PERSONA_AWARE_PAYWALL` returns the same shape as `https://portal-stg.zenuml.com/feature-flags?...`. Same for full-stg and dia-stg.
3. **Frontend cutover** — merge the `portalDomain.ts` change. Now Forge clients call their own backend.
4. **Soak period (~1 week)** — monitor `get_feature_flags` error tracking + AI usage. Old `portal.zenuml.com` Worker still running and untouched.
5. **Decommission** — delete `zenuml-portal-staging` Worker, then `zenuml-portal-production`. Remove the `portal.zenuml.com` / `portal-stg.zenuml.com` DNS records last.
6. **Archive repo** — `zenuml-portal` GitHub repo archived.

## Risks and mitigations

### Old Forge bundles in the wild
Forge bundles cached on client devices may still reference `portal.zenuml.com` for some time after cutover. Mitigation: keep the standalone Worker + DNS alive for the soak period (step 4). Atlassian's Forge force-upgrade typically takes effect within days.

### KV write paths
The current zenuml-portal Worker has read-only `/feature-flags`. If anything writes to `KV_FEATURE_FLAGS` (admin tooling, scripts), audit and confirm it doesn't depend on the Worker URL. *Open item: confirm no write callers exist before step 5.*

### CORS
Today: Forge iframe (cdn.prod.atlassian-dev.net) → `portal.zenuml.com` (cross-origin, CORS allowed via `cors()` middleware in Hono).
After: Forge iframe → `conf-{variant}.zenuml.com` (cross-origin, conf-app already serves cross-origin Forge requests via its existing `_middleware.ts`). Confirm `_middleware.ts` allows the new endpoints — it should, since the existing `functions/api/features.ts` is already called from Forge.

## Out of scope

- Renaming `KV_FEATURE_FLAGS` namespace, restructuring its key schema.
- Touching the existing `functions/api/features.ts` (Forge-context feature flags — different endpoint, different purpose).
- Any change to the `getFeatureFlagsForCurrentDomain` API surface used by `useCustomerSuccessService`.

## Success criteria

- `zenuml-portal` Worker deleted from both staging and production.
- `portal.zenuml.com` DNS records removed.
- `zenuml-portal` repo archived.
- `getFeatureFlagsForCurrentDomain` and `ai-generate-title` callers continue to work for all three variants in prod.
- No new error rate visible in `get_feature_flags` Mixpanel events.
