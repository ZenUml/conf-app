# Lite paywall default-on with explicit exemptions

**Date:** 2026-08-04  
**Status:** Approved design  
**Scope:** Lite variant only

## Summary

Change the Lite paywall from an explicit tenant allowlist to a default-on policy. Every Lite
tenant receives the existing metered paywall unless its domain is present in one small reverse
exemption list. Keep the implementation deliberately narrow: the default behavior is fixed in
code, the only runtime decision is an exemption boolean, and failures always leave editing
available.

Version 1 does not change Full, Diagramly, or AsyncAPI behavior. In particular, it does not add
Full license-state checks, Legacy Free messaging, or a Full-app nudge.

## Context

The current `CUSTOMER_SUCCESS_SERVICE` (CSS) value is a JSON map keyed by Confluence subdomain.
Only matching domains receive the Lite warning and metered paywall. The same CSS map now also
controls enrollment in the daily macro-count snapshot job.

Those responsibilities cannot be inverted together. Making an absent CSS entry mean "paywall
on" inside the snapshot service would expand the expensive daily Confluence scan to every Lite
installation. Conversely, continuing to use CSS as the paywall allowlist would require maintaining
an ever-growing list when the desired product behavior is that Lite is metered by default.

The existing Lite product behavior remains unchanged:

- warning state begins at 85 macros per space;
- the metered soft paywall begins at 100 macros per space;
- a user has 15 continue-editing attempts per user and space;
- active user-scoped or space-scoped licenses bypass the restriction;
- the gate fails open when its count or paid-state inputs cannot be used.

## Goals

1. Make the existing metered paywall the default for all Lite tenants.
2. Allow a small number of tenants, or the whole fleet during an incident, to be exempted without
   a deployment.
3. Preserve fail-open behavior for missing, malformed, or unreachable configuration.
4. Leave the macro-count snapshot cohort unchanged.
5. Preserve all non-Lite behavior byte-for-byte wherever practical.
6. Reuse existing paywall analytics and add only the property needed to explain the new decision.

## Non-goals

- Full Legacy Free detection or messaging.
- Any Full, Diagramly, or AsyncAPI paywall behavior.
- A general paywall policy engine.
- Per-tenant modes such as `nudge`, `metered`, or custom thresholds.
- Percentage rollout or randomized holdout cohorts.
- Changes to the 85/100 thresholds, continue-attempt count, modal behavior, pricing, or purchase
  surfaces.
- Expansion or redesign of the daily macro-count snapshot job.
- Renaming `CUSTOMER_SUCCESS_SERVICE` in this change.

## Considered approaches

### 1. Fixed Lite default plus one exemption map — selected

Keep the default behavior in code and add a single `PAYWALL_EXEMPTIONS` KV value. This produces one
runtime boolean, a simple rollback, and no tenant-specific policy machinery.

### 2. Invert `CUSTOMER_SUCCESS_SERVICE` — rejected

This is superficially the smallest change, but CSS is also the macro-count snapshot enrollment
list. Inverting it would either expand daily scans to the whole Lite fleet or give one map
conflicting meanings in different call sites.

### 3. Move targeting to Forge Developer Console flags — rejected for v1

Developer Console targeting supports richer rollout rules, but it makes the live exception list
harder to inspect and update through the existing operational scripts. The feature does not need
percentage targeting or per-user rules.

## Configuration contract

Add one production/staging KV key in the existing `KV_FEATURE_FLAGS` namespace:

```json
{
  "*": true,
  "example-tenant": true
}
```

The value is a JSON object whose keys are subdomain prefixes and whose values are booleans.

- A tenant key set to `true` exempts that tenant.
- `"*": true` exempts every tenant and is the emergency kill switch.
- Missing tenant keys are not exempt.
- False values are treated the same as absent values.
- The map is intentionally boolean-only. Reasons, approvals, and expiry decisions belong in the
  private paywall runbook rather than the runtime contract.
- Real tenant domains must never appear in public repository files.

`CUSTOMER_SUCCESS_SERVICE` remains untouched and continues to mean explicit macro-count snapshot
enrollment. Existing CSS data is not copied into the new map except for tenants that genuinely
need an exemption.

## Backend behavior

Extend the existing `/feature-flags` endpoint with a `PAYWALL_EXEMPT` feature result.

For a valid `PAYWALL_EXEMPTIONS` object:

| Condition | Response |
|---|---|
| `"*"` is `true` | `PAYWALL_EXEMPT: true` |
| current domain is `true` | `PAYWALL_EXEMPT: true` |
| neither matches | `PAYWALL_EXEMPT: false` |

If the KV key is missing, cannot be read, is not valid JSON, or is not a JSON object, the endpoint
must omit `PAYWALL_EXEMPT` rather than return `false`. A missing result is an unavailable decision,
not evidence that the tenant is safe to restrict.

The current CSS handler remains available for snapshot and backwards-compatibility consumers.

## Frontend behavior

Only the Lite variant requests `PAYWALL_EXEMPT`. Non-Lite variants do not make the new lookup.

The Lite decision is:

```ts
const policySource = response.PAYWALL_EXEMPT === undefined
  ? 'fail_open'
  : response.PAYWALL_EXEMPT
    ? 'exemption'
    : 'default_on'

const paywallEnabled = isLite && policySource === 'default_on'
const shouldBlock = paywallEnabled && !spacePaid && macroCount >= 100
```

The warning state uses the same `paywallEnabled` value with the existing 85-macro threshold.

The existing precedence remains:

1. non-Lite variant: unrestricted;
2. unavailable exemption decision: unrestricted;
3. global or domain exemption: unrestricted;
4. active user/space license: unrestricted;
5. otherwise apply the existing Lite thresholds.

No generic resolver or tenant-specific mode type is introduced. The existing customer-success
composable owns the additional boolean alongside its current macro-count and paid-space inputs.
The existing `mockCSSEnabled` developer override remains available so sandbox and E2E fixtures do
not need a parallel mock system; it overrides the effective Lite paywall decision only in the
existing local-test path.

The page-banner marker keeps its current eventual-consistency behavior. Adding an exemption stops
the edit/create/fullscreen gate on the next macro iframe load, but an already-persisted page-banner
marker may remain until a macro iframe refreshes it. Version 1 does not add a second exemption
lookup to the page-banner iframe solely to make that warning disappear synchronously.

## Analytics contract

Per repository policy, analytics contract changes are the first commit of the implementation
branch.

Reuse the existing `paywall_gate_evaluated` event. Do not add an event name.

| Field | Contract |
|---|---|
| Event | `paywall_gate_evaluated` |
| Trigger | Every Lite edit, create, or fullscreen gate decision after initialization |
| New property | `paywall_policy_source` |
| Values | `default_on`, `exemption`, `fail_open` |
| Existing outcome | `gate_fired` |
| Existing decision inputs | `macro_count`, `macro_count_source`, `space_paid`, `space_paid_scope`, `is_lite` |

Register the new property type in `src/utils/analytics/catalog.ts` and
`src/utils/analytics/types.ts` before changing gate behavior. Keep `css_enabled` temporarily for
saved-query compatibility, but treat `paywall_policy_source` as the authoritative rollout
dimension. No Full event volume should be introduced.

Existing downstream events remain unchanged: `paywall_triggered`, `paywall_continue_used`,
`paywall_attempts_exhausted`, `extension_request_clicked`, advocacy events, purchase-CTA events,
and save/create outcomes.

## Operational tooling

The current paywall skill treats live CSS membership as the authoritative treatment cohort. That
becomes incorrect after default-on and must change in the same delivery:

- add a small validated read/put helper for `PAYWALL_EXEMPTIONS`;
- keep `css_flag.py` for macro-count snapshot enrollment and historical CSS operations;
- derive the daily paywall monitoring table from domains that emitted paywall activity in the
  requested window, excluding explicit exemptions and internal sites;
- do not try to print a row for every Lite installation;
- treat any post-rollout trigger from an explicitly exempt tenant as an anomaly after allowing for
  old cached bundles;
- record real exception reasons and dates only in the private paywall runbook.

Public operational docs must describe the new default-on semantics without listing customer
domains.

## Rollout

The purchase surfaces must be merged and deployed before broad activation. As of design approval,
the prerequisite work is tracked in PRs #407 and #408.

1. Add the analytics property contract as the first feature-branch commit.
2. Create `PAYWALL_EXEMPTIONS` in the staging namespace.
3. Validate on staging with both a default-on decision and an explicit exemption.
4. Before deploying production code, create the production key with `"*": true` plus any approved
   domain exemptions. Translate every current CSS `-x-` soft-disable and every active private
   do-not-enroll commitment into a real-domain exemption without placing those domains in this
   public spec. This makes the new path inert and fail-open.
5. Deploy the code and verify that production is reading `exemption` rather than `fail_open`.
6. Remove the wildcard in one validated read-modify-write operation, retaining domain exemptions.
7. Verify `default_on` evaluations and the existing paywall lifecycle events.
8. Monitor the first 24 hours closely, then use the existing seven-day rollout-shock and four-week
   momentum framework for tenant-level decisions.

During the brief inert deployment window, new bundles may exempt the previously enrolled CSS
cohort while older cached bundles continue using CSS. This is an acceptable fail-open transition;
no user is newly blocked until the wildcard is removed.

## Rollback and tenant exits

Fleet rollback is a KV-only action:

```json
{
  "*": true
}
```

Preserve existing domain entries when adding the wildcard. New iframe sessions will honor the
rollback immediately; an already-open iframe may require refresh because the decision is loaded
once per iframe lifecycle. An already-open modal is not retroactively removed, and the page-banner
marker follows the existing eventual-consistency behavior described above.

Tenant-level exits add the real domain to `PAYWALL_EXEMPTIONS`. Use the existing suppression rule:
after the seven-day shock window, sustained four-week edit momentum below 0.7 with a meaningful
pre-period volume and no active conversion motion is grounds for exemption. Active negotiations or
temporary user/space grants continue through their existing mechanisms rather than automatically
creating a domain exemption.

## Verification

### Unit tests

Backend feature-flag tests cover:

- valid map, unlisted domain returns `false`;
- domain exemption returns `true`;
- wildcard exemption returns `true`;
- false entries do not exempt;
- missing key, malformed JSON, non-object JSON, and KV read failure omit the result.

Customer-success tests cover:

- an unlisted Lite tenant is enabled by default;
- domain and wildcard exemption disable warning and blocking;
- missing/failed responses disable warning and blocking;
- paid user/space status still wins;
- the 85/100 thresholds and 15-attempt flow are unchanged;
- Full remains unrestricted and does not request the new feature;
- Diagramly and AsyncAPI remain unrestricted.

Analytics tests verify the three `paywall_policy_source` values on
`paywall_gate_evaluated` and confirm that non-Lite variants emit no new gate events.

Snapshot tests continue to prove that only truthy `CUSTOMER_SUCCESS_SERVICE` members are scanned.

### UI evidence

Use Playwright because the Forge Custom UI is inside a cross-origin iframe. Capture UI evidence for:

1. a non-exempt Lite space at or above 100 macros showing the paywall modal;
2. the same condition with an explicit exemption opening the editor without the modal;
3. a Full macro opening without any paywall regression.

A unit test is not sufficient evidence for these UI assertions. If an assertion cannot be driven,
mark it skipped with the exact blocker.

### Build coverage

Run the relevant unit suite and all four product builds. Full, Diagramly, and AsyncAPI builds are
regression coverage, not rollout targets.

## Success and guardrails

The rollout is technically successful when:

- unlisted Lite tenants resolve to `default_on`;
- explicit exemptions resolve to `exemption` and produce no new paywall triggers after bundle
  propagation;
- unavailable configuration resolves to `fail_open`;
- Full and other variants remain unchanged;
- daily macro-count scanning remains confined to CSS enrollment;
- the wildcard rollback has been read-back verified.

Business outcomes continue to be measured through trigger breadth, purchase-CTA clicks, extension
requests, both payment rails, and save/create momentum. Default-on is not itself evidence of
conversion; a telemetry signal and a paid outcome must remain separate in reporting.

## Deferred follow-up

A later, separately designed version may consider a non-blocking renewal nudge for Full Legacy Free
installations. It must not be implemented as part of this Lite-only change.

## Addendum (2026-08-07)

Two owner-directed changes shipped alongside implementation, both narrower than the deferred
follow-up above:

1. **Paid-rail trial suppression.** `functions/api/space-status.ts` now checks D1
   (`ForgeInstallation`) after both existing license checks miss: a cloudId with a Full or
   Diagramly install created within the last 45 days (30-day Atlassian trial + buffer) returns
   `isPaid: true, source: 'paid_rail'`, suppressing the Lite paywall for that tenant. This is our
   own D1, not the Marketplace API, and is deliberately time-boxed — it is not a substitute for a
   real license check. Long-term paid Full/Diagramly tenants still need an explicit
   `PAYWALL_EXEMPTIONS` entry; the query does not look them up.
2. **Stripe activation precondition.** `functions/api/stripe-webhook.ts` previously read only
   `session.metadata`, which Stripe Payment Links cannot set — so every Bundle purchase through the
   purchase-surface Payment Link 400'd and never activated a space license. The webhook now falls
   back to parsing `client_reference_id` (`<domain>__<spaceKey>`, stamped by the purchase surface)
   and resolving `cloudId` via `tenant_info` when metadata is absent, 500ing (not 400) on a
   transient resolution failure so Stripe retries. This is a rollout precondition for default-on:
   without it, a real Bundle purchase on a newly-paywalled tenant would silently fail to unlock.
