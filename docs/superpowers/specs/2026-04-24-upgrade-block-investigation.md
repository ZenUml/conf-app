# Investigation Plan: Why `CUSTOMER_SUCCESS_SERVICE` flag never produces `blocked` events

**Date:** 2026-04-24
**Owner:** @eagle
**Status:** Not started

## Problem

`CUSTOMER_SUCCESS_SERVICE` is enabled in KV (`fe9042cb20994651b0a2ef9e68f9037c`) for 27 production domains, including `colesgroup`. Coles has 8 spaces over the 100-macro hard-block threshold (KV `metrics:colesgroup:full` — AGWS alone at 1,079 macros).

Expected: any edit action on those spaces should trigger `UpgradeEventName.ACTION_BLOCKED` → Mixpanel event `blocked` with `event_label="upgrade_action_blocked"`.

Observed: **zero `blocked` events ever** across all 27 enabled tenants, in all of Mixpanel history we can see.

Something in the runtime pathway silently fails. Conversion pressure from this flow is currently zero.

## Hypotheses (ranked by suspected likelihood)

| # | Hypothesis | Why plausible | How to verify |
|---|---|---|---|
| H1 | `macrosCreated` stays at 0 because `macroMetrics.getMacroMetrics()` returns nothing or wrong shape | Client fetches metrics from an endpoint that differs from `/admin/metrics-inspect`. Shape mismatch → default to 0. | Open a Coles user's session (or reproduce on `zenuml` tenant which is also in the flag) and inspect `macrosCreated.value` + the raw response in devtools. |
| H2 | `spacePaidStatus` returns `true` by default (bypasses block) | The bypass has a `return false` early-exit. If `/api/space-status` returns `paid: true` for unpaid spaces due to a default, the block is skipped silently. | Inspect `spacePaidStatus.value` after `initialize()` + hit `/api/space-status?domain=colesgroup&space=AGWS` directly and read the response. |
| H3 | `isLite()` is false in the environment where we'd expect blocks | Flag check requires `isLite && customerSuccessServiceEnabled && macros >= 100`. If `globals.apWrapper.isLite()` returns false (Forge migration edge case?), the block shortcircuits. | Log `globals.apWrapper.isLite()` in a Forge Lite session. Cross-check with `PRODUCT_TYPE` build var. |
| H4 | Feature flag isn't read — bug in `getFeatureFlagsForCurrentDomain` path for this domain | Possible caching / domain-matching bug (e.g. case, trailing slash, subdomain extraction). | Log `customerSuccessServiceEnabled.value` after `initialize()`. Confirm it's `true` for `colesgroup`. |
| H5 | `edit()` method never runs — Coles users enter the editor via a path that doesn't call `GenericViewer.vue:edit()` | Possible if users click the Confluence-native edit button, a keyboard shortcut, or a different component. | Grep for other entry points to edit flow. Check editor mount paths. |
| H6 | `trackUpgradeEvent` call throws before reaching mixpanel | Defensive order: check `return` in `edit()` happens after `trackUpgradeEvent`; if tracking throws, the block still happens but without telemetry. | Read `src/components/Viewer/GenericViewer.vue:240-275`, check if trackUpgradeEvent is inside a try/catch or can throw silently. Mixpanel is wrapped in try/catch in `window.ts` but label/action mapping could fail earlier. |
| H7 | Flag was enabled recently — no Coles edit on a heavy space since | Low likelihood given Coles did ~375 edit versions in Oct 2025 alone, but check the flag's KV update timestamp. | `wrangler kv key get` supports `--metadata` flag, check write time. Compare to Mixpanel edit timestamps. |

## Stage 1 findings (2026-04-24, static analysis)

**Narrowed from 7 hypotheses to 1 strong candidate, plus two red herrings.**

### Confirmed (strong signal)

1. **`loadCSSFeatureFlag` success path never fires in production, for any tenant.**
   - Mixpanel: 0 `system` events with `event_label=upgrade_feature_enabled` ever — across all ~10 months and all 27 enabled domains.
   - Mixpanel: 0 `system` events with any label — the `FEATURE_ENABLED` tracking is completely silent in production.
   - Mixpanel: 42 `get_feature_flags` error events total (147 event hits, all labeled `"Failed to fetch"`), spread across 42 tenants, 6 for colesgroup. These are network-layer failures on the fetch itself.
   - Backend is healthy: `curl https://portal.zenuml.com/feature-flags?client=colesgroup&features=CUSTOMER_SUCCESS_SERVICE` returns `{"CUSTOMER_SUCCESS_SERVICE":true}`. CORS is `*`.

   The most consistent explanation is that `loadCSSFeatureFlag` reaches `fetch()` but the response body does NOT contain the flag (empty `{}`), so `!!customerSuccessService.CUSTOMER_SUCCESS_SERVICE === false`, `FEATURE_ENABLED` is not fired, and `customerSuccessServiceEnabled.value` stays false. That happens when the `client` query param passed to the endpoint is empty or wrong.

### Ruled out

- **H4 (endpoint bug)**: endpoint works fine when hit directly with correct client.
- **Client origin not in manifest**: `external.fetch.client` allows `https://*.zenuml.com` which covers `portal.zenuml.com`.
- **Domain extraction globally broken**: Mixpanel events show `client_domain` resolved correctly for 99.996% of Forge events (24,787 / 24,788), so `getClientDomain()` works. But `getAtlassianDomain()` in `src/apis/featureFlags.ts` is a **separate function** with different extraction logic and may still fail.

### Still open — the real question

**Why does `getAtlassianDomain()` in `featureFlags.ts` return empty/wrong when `getClientDomain()` in `ContextParameters.ts` works?** They read the same underlying source (`extension.location` / `currentPageUrl`) but through different code paths. The sensible next step is to instrument, not argue from code.

## Plan

### Stage 1 — Static code review (30min, no deployment)

**Goal:** Narrow the field from 7 hypotheses to 2-3 by reading code paths end-to-end.

Files to read carefully:
- `src/composables/useCustomerSuccessService.ts` — full `initialize()` and all getters
- `src/services/MacroMetrics.ts` — how `getMacroMetrics()` resolves count
- `src/apis/featureFlags.ts` — how `getFeatureFlagsForCurrentDomain` reads the flag
- `src/utils/ContextParameters/ContextParameters.ts:getClientDomain` — domain extraction
- `src/components/Viewer/GenericViewer.vue` — `edit()` path + `mounted()` initialize order
- `functions/api/space-status/` — default response shape
- `src/model/globals.ts` (ApWrapper2) — `isLite()` implementation for Forge
- Build variants in `package.json` (`PRODUCT_TYPE`) and how it threads to `isLite()`

Outcome: write up which hypotheses survive, which are ruled out, with file:line evidence.

### Stage 1.5 — Quick fix attempt (proposed, 30min)

Before full live repro, try the cheapest plausible fix: replace `getAtlassianDomain()` in `src/apis/featureFlags.ts` with a call to `getClientDomain()` from `ContextParameters.ts`. That function is demonstrably working in production (Mixpanel proof). Unify on it.

Draft change:
```ts
// src/apis/featureFlags.ts
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters';

export default async function (features: string[]) {
  try {
    const client = getClientDomain();  // ← was: await getAtlassianDomain()
    if (!client) {
      trackEvent('empty_client_domain', 'get_feature_flags', 'error');
      return {};
    }
    const portal = getPortalDomain();
    const response = await fetch(`${portal}/feature-flags?client=${client}&features=${features.join(',')}`);
    ...
  }
}
```

Also: emit a one-shot tracking event on **entry** to the flag check so we can see attempts, not just outcomes (e.g. `trackEvent(client, 'get_feature_flags', 'attempt')`). Without this we can't tell "fetch returned empty" from "fetch never ran". Without the attempt event, after a deploy we're still blind.

If this fix is the root cause, expect:
- `system` events with label `upgrade_feature_enabled` to start firing for all 27 flagged domains within an hour of deploy.
- `blocked` events to follow once a flagged tenant edits a 100+ macro space (Coles has 8 such spaces).

### Stage 2 — Live reproduction (1-2h)

**Goal:** Get a working block in a controlled environment, then compare with prod behavior.

1. Install on `zenuml.atlassian.net` (already in the flag list) via the Lite build. Create 100+ macros in one space (script via the E2E harness or use a page-generator script).
2. Attempt an edit on that space. Observe:
   - Does the modal appear?
   - Does `blocked` event hit Mixpanel?
   - What do the console `console.log('🚫 shouldBlockActions check:', ...)` lines say?
3. If it works locally → prod has a data problem (H1/H2/H4). If it fails locally too → code bug (H3/H5/H6).

If repro succeeds but prod doesn't:
4. Hit `/api/space-status` for a real Coles space from a staging-authenticated request and log the response.
5. Hit whatever endpoint `MacroMetrics` fetches and compare to the `/admin/metrics-inspect` numbers.

## Stage 2 findings (2026-04-24, live browser via Playwright)

Opened `zenuml-stg.atlassian.net` in Playwright with an existing ZenUML page. Two surprises:

### Finding 1 — mock flag was set in the Forge iframe, short-circuiting the real code
Console showed `🧪 Using mock CSS Feature Flag: true` — meaning `localStorage.mockCSSEnabled` is set in the Forge app's iframe origin (CDN host under `*.cdn.prod.atlassian-dev.net/<app-id>`). `loadCSSFeatureFlag` short-circuits on this and never calls the fetch. This is a dev artifact on this particular browser — not the prod root cause — but it's a noisy confound that makes staging an unreliable place to reproduce.

Network log confirmed: **0 requests to `/feature-flags`** were issued during this page render.

### Finding 2 (bigger) — `portal-stg.zenuml.com` has no feature flag data
Ran direct `fetch()` from the `conf-stg-full.zenuml.com` origin:

| Target | Client | Response |
|---|---|---|
| `portal-stg.zenuml.com` | `colesgroup` | `{}` |
| `portal-stg.zenuml.com` | `zenuml` | `{}` |
| `portal-stg.zenuml.com` | `zenuml-stg` | `{}` |
| `portal-stg.zenuml.com` | *(empty)* | `{}` |
| `portal.zenuml.com` | `colesgroup` | `{"CUSTOMER_SUCCESS_SERVICE":true}` |
| `portal.zenuml.com` | *(empty)* | `{}` |

**Staging portal's feature-flag KV is empty.** Only the prod portal has any flag data. This has two consequences:

- Any verification attempt on staging will see the flag as `false` regardless of code correctness. **Staging cannot validate this fix.** The only way to verify is to deploy to production and watch the new `get_feature_flags_attempt` telemetry.
- This also means the 27-domain enablement we saw in prod KV is entirely prod-side; staging is a blank slate.

### What this means for the investigation

Stage 2 did NOT prove or disprove the `getAtlassianDomain()` hypothesis — staging was the wrong environment. Three things remain possible for prod:

1. **`getAtlassianDomain` returns empty in Forge** → my original hypothesis; the fix unifies on `getClientDomain` which demonstrably works in Mixpanel.
2. **Client param is correct but something downstream drops the flag value** → unlikely given the direct curl works.
3. **`initialize()` never runs for viewer sessions** → would also silence `FEATURE_ENABLED`, but tests show it's wired to `GenericViewer.mounted`, which fires on every `view_macro`.

Hypothesis 1 remains most plausible. The Stage 1.5 fix + attempt telemetry will tell us definitively within minutes of a prod deploy.

### Follow-up task

**Bug to log separately**: `portal-stg.zenuml.com` should mirror prod flag config (or at least seed stub data for known staging clients like `zenuml-stg`). Without this, the `CUSTOMER_SUCCESS_SERVICE` flow is untestable in staging.

### Stage 3 — Fix or instrument (variable)

**If a bug is found:**
- Fix it.
- Add a targeted unit test that covers the specific failure mode.
- Deploy to staging, verify `blocked` fires, then roll to prod.

**If no bug is found but flag is clearly not doing anything useful:**
- Add explicit telemetry: emit a `system` event on each `shouldBlockActions` evaluation with `{macros, threshold, isLite, spacePaid, flagEnabled, wouldBlock}`. That tells us *per-request* why the block didn't fire.
- Keep it until one Coles block fires, then roll back to only-block tracking.

### Stage 4 — Document + close

- Update `docs/superpowers/specs/2026-04-24-upgrade-block-investigation.md` with findings.
- Update `reference_customer_data_sources.md` memory to remove the "gotcha" if the pathway is fixed.
- Log a Flywheel entry summarizing root cause.

## Success criteria

- Root cause is identified with file:line evidence.
- Either (a) a fix is shipped and at least one `blocked` event fires in prod within 24h, or (b) a definitive "not actually blockable because X" answer is documented and the flag's purpose is rethought.

## Out of scope

- Changing the `MACROS_LIMIT` value or thresholds.
- Redesigning the UpgradePrompt UI.
- Customer outreach for Coles or any tenant (no email access — product constraint).
- Adding new conversion surfaces (separate spec if needed).
