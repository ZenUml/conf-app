# Feature flags — which provider, and why

We run two feature-flag systems. This document is the decision framework for
choosing between them, the inventory of what lives where, and the lifecycle
rules. The machine-readable source of truth is
[`src/utils/featureFlags/registry.ts`](../../src/utils/featureFlags/registry.ts) —
every flag is declared there with its provider, and `registry.spec.ts` guards
against drift between the registry and the evaluating modules.

## The two providers

| | **Forge feature flags** | **Cloudflare KV flags** |
|---|---|---|
| Where it lives | Forge Developer Console, per app (lite / full / diagramly / asyncapi are **separate apps with separate flag inventories**) | `KV_FEATURE_FLAGS` namespace, one shared backend (per Pages project) |
| Evaluated | Client-side in the Custom UI iframe (`@forge/bridge` `FeatureFlags` SDK; config downloaded once via the bridge, `checkFlag` local). No Forge Function invoked — zero GB-seconds; our backend not in the path | Server-side by `functions/feature-flags.ts`; frontend fetches via `src/apis/featureFlags.ts` (`GET /feature-flags?client=…&features=…`) |
| Value shape | Boolean only | Arbitrary JSON (e.g. per-domain config objects) |
| Scope / targeting | Per install (`installContext` ARI) + accountId bucketing; env targeting (dev/staging/prod); **percentage rollouts** | Per client domain (keys inside the JSON value); any custom shape you encode |
| Toggle latency | Console change, no deploy; applies on next iframe mount (renderGate adds a 30-min localStorage cache on top) | `wrangler kv` write, no deploy; applies on next fetch |
| Limits | **Max 10 flags per app** (lite hit the cap 2026-07-25) | Effectively unlimited |
| Availability coupling | Works whenever the Forge bridge works — independent of our backend | Requires our Cloudflare backend to be up |
| Server-side visibility | **None** — our Workers cannot read Forge flags | Full — Workers read KV directly |

## Decision rules

Pick **Forge** when the flag is:

1. a boolean kill switch or staged rollout for **client-side behavior** (new UI,
   render-path change, sampling rate);
2. something you may want to **percentage-ramp** or target per install/user;
3. needed even when our Cloudflare backend is degraded — Forge flags are the
   only option for anything on the render/edit path, because rendering **must
   not depend on our backend** (see CLAUDE.md, Content management).

Pick **Cloudflare KV** when the flag:

1. must be read **server-side** (a Worker/Pages Function branches on it);
2. carries a **non-boolean payload** (per-domain config, allowlists);
3. is **operator-curated per tenant domain** (e.g. paywall enrollment), where
   "the value" is really a small dataset, not a toggle;
4. would not fit the 10-per-app Forge cap, or must be shared across variants
   from one place.

Both systems are **fail-closed by convention**: a missing flag, an evaluation
error, or a dead backend must resolve to today's behavior (`checkFlag(key,
false)` everywhere; KV fetch errors return `{}`). A flag that fails open is a
bug.

## Code entry points

- **Registry (start here):** `src/utils/featureFlags/registry.ts` — declare the
  key + provider first, import the key from here in the evaluating module.
- **Forge, one-shot reads:** `src/utils/featureFlags/forgeFlagClient.ts` —
  `checkForgeFlag(label, key, deps?)` for a single boolean;
  `evaluateForgeFlags(label, fn, deps?)` when one init serves several flags
  (see `sessionReplayFlags.ts`). Handles identity (install ARI from cloudId,
  accountId bucketing), env mapping, fail-closed, and client shutdown.
- **Forge, long-lived client:** `src/apis/aiTitleFeatureFlag.ts` keeps a
  memoized client for repeated editor-session reads — the exception, not the
  template.
- **KV:** `src/apis/featureFlags.ts` (frontend fetch) →
  `functions/feature-flags.ts` (KV read). New KV-served feature names must be
  handled there, and any new function path added to `public/_routes.json`.

## Inventory

Forge Console flags (all `site-user` scoped, all default-off):

| Key | Gates | Evaluated in |
|---|---|---|
| `ai-title-enabled` | AI diagram titles | `src/apis/aiTitleFeatureFlag.ts` |
| `ai-repair-enabled` | AI Repair on syntax errors | `src/apis/aiTitleFeatureFlag.ts` |
| `agent-link-enabled` | Live Agent Link master switch | `src/apis/aiTitleFeatureFlag.ts` |
| `viewport-gated-render` | #382 viewer viewport gate | `src/utils/renderGate/flags.ts` |
| `editor-staleness-hint-enabled` | Editor staleness hint | `src/utils/stalenessHint/flags.ts` |
| `session-replay` | Mixpanel replay general sampling (rollout % = live rate) | `src/utils/analytics/sessionReplayFlags.ts` |
| `session-replay-full` | Targeted 100% replay capture | `src/utils/analytics/sessionReplayFlags.ts` |

Cloudflare KV flags (`KV_FEATURE_FLAGS`, served by `/feature-flags`):

| Key | Gates | Evaluated in |
|---|---|---|
| `CUSTOMER_SUCCESS_SERVICE` | Lite paywall enrollment — JSON object keyed by client domain | `src/composables/useCustomerSuccessService.ts` (via `src/apis/featureFlags.ts`) |

**Related KV records that are NOT feature flags** (listed to prevent
mis-filing): `SPACE_LICENSE_KV` holds `license:*` entitlement records
(space/user paywall extensions — `functions/api/space-status.ts`, see the
`extend-space-license` skill) and `cohort:user:*` targeting cohorts
(`functions/api/user-cohorts.ts`). They are entitlements/cohort data with
their own contracts, not toggles; don't add them to the registry.

## Lifecycle

**Adding a flag**

1. Decide the provider with the rules above; add the key to
   `FORGE_FLAGS`/`KV_FLAGS` and an entry in `FEATURE_FLAG_REGISTRY`.
2. Evaluate it through the entry points above — never a bare string literal at
   the call site, never fail-open.
3. Forge: create the Console flag **per app variant** you ship it in (the
   `forge-feature-flag` skill has the workflow, Console URLs, and the
   env-chip verification trap — a new flag's rule defaults to dev+staging
   only). Mind the 10-flag cap; retiring may have to come first.
4. KV: extend `functions/feature-flags.ts` (or a dedicated function +
   `public/_routes.json` entry) and write the KV value with `wrangler kv`.
5. Per CLAUDE.md, plan the feature's Mixpanel events before implementing the
   gated feature itself.

**Retiring a flag** (order matters for Forge)

1. Remove the code gate (feature fully on or fully removed) and **release**.
2. Only then delete the Console flag — deleting first flips a live-at-100%
   flag back to its `false` default and silently disables a shipped feature.
3. Remove the registry entry in the same PR as the code-gate removal.

**Verifying a Forge flag** — never trust the Console header alone; prove the
runtime value on a live macro (Mixpanel event properties or debug logs). Reads
without a browser: `node
.claude/skills/forge-feature-flag/scripts/flags-status.mjs`.
