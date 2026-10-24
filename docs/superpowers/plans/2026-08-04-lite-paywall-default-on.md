# Lite paywall default-on implementation plan

> **Execution:** Complete the implementation tasks in order on one isolated
> feature worktree. Keep production inert behind the wildcard exemption until
> the explicit activation gate. Do not implement or release Full behavior.

**Goal:** Make the existing metered paywall the default for Lite tenants while
preserving one boolean exemption lookup, fail-open behavior, and the existing
CSS-backed macro-count snapshot cohort.

**Design:**
[`docs/superpowers/specs/2026-08-04-lite-paywall-default-on-design.md`](../specs/2026-08-04-lite-paywall-default-on-design.md)

**Base:** `origin/main` after the approved design/plan docs. Rebase onto the
purchase-surface work in PRs #407 and #408 before landing.

## Non-negotiable constraints

- Version 1 changes Lite behavior only. Do not add Full license-state checks,
  Legacy Free detection, Full messaging, or a Full production release.
- The first commit on the implementation branch changes only
  `src/utils/analytics/catalog.ts` and `src/utils/analytics/types.ts`.
- Runtime policy stays fixed: Lite is on by default; the only remote decision
  is the boolean `PAYWALL_EXEMPT` result. Do not add modes, percentages,
  thresholds, a generic resolver, or a separate default switch.
- Missing, unreadable, or invalid exemption configuration is fail-open. It must
  never be converted to `PAYWALL_EXEMPT: false`.
- `CUSTOMER_SUCCESS_SERVICE` remains the daily macro-count snapshot enrollment
  map. Do not invert it, bulk-copy it, or expand the snapshot job.
- Keep the legacy-named `mockCSSEnabled`, `cssEnabled`, and page-banner marker
  field as compatibility shims. They represent the effective paywall-enabled
  boolean after this change; do not add a second mock or marker schema.
- Do not put real tenant domains, exemption reasons, cloud IDs, or customer page
  titles in public code, tests, docs, logs committed to git, or PR text.
- No production KV mutation or release is part of code implementation. Those
  operations begin only at the separately called-out rollout gate.

## Task 1: Land docs, re-check prerequisites, and create an isolated branch

The design and this plan are `.md`-only work and should land on `main` under the
repository documentation exception. Push them before creating the code branch,
so the first feature commit is the analytics contract rather than documentation.

Verify the prerequisite PR state immediately before implementation:

```bash
gh pr view 407 --repo ZenUml/conf-app --json state,mergedAt,url
gh pr view 408 --repo ZenUml/conf-app --json state,mergedAt,url
```

As of 2026-08-04 both PRs are still open. They must be merged and their purchase
surfaces deployed before the production wildcard is removed. If implementation
starts before then, do not activate production and rebase after both merge.

Because the primary workspace may contain another session's changes, inspect it
without altering it and create a dedicated worktree from updated `origin/main`:

```bash
git status --short --branch
git fetch origin
git worktree add ../conf-app-lite-paywall-default-on \
  -b feat/lite-paywall-default-on origin/main
```

Initialize only the build submodule needed by the AsyncAPI regression build:

```bash
git submodule update --init --recursive vendor/asyncapi-studio
```

Do not initialize or read the private submodule until the production exemption
inventory task actually needs it.

## Task 2: Register the analytics contract — first feature commit

**Files:**

- Modify `src/utils/analytics/catalog.ts`
- Modify `src/utils/analytics/types.ts`

Add a bounded source type next to the existing paywall count-source type:

```ts
export type PaywallPolicySource = 'default_on' | 'exemption' | 'fail_open';
```

Import it into `types.ts` and register the new optional property on
`AnalyticsProperties`:

```ts
paywall_policy_source?: PaywallPolicySource;
```

Document at the type that this property belongs to `paywall_gate_evaluated`:

- `default_on`: the backend explicitly returned `PAYWALL_EXEMPT: false`;
- `exemption`: the backend explicitly returned `PAYWALL_EXEMPT: true`;
- `fail_open`: the property was absent or the lookup was unusable.

Do not add a new event name and do not remove `css_enabled`.

Run a compile-oriented check:

```bash
pnpm exec vue-tsc --noEmit
```

If the repository has a pre-existing typecheck baseline, compare it with a clean
`origin/main` checkout and require no new error. Before committing, confirm the
staged set contains exactly the two analytics files:

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git diff --cached --name-only
git commit -m "feat(analytics): declare paywall policy source"
```

## Task 3: Expose the exemption decision from `/feature-flags`

**Files:**

- Modify `functions/feature-flags.ts`
- Modify `tests/unit/feature-flags.spec.ts`

### Red

Add focused endpoint tests for a request whose `features` contains
`PAYWALL_EXEMPT`:

1. valid map + unlisted domain returns `PAYWALL_EXEMPT: false`;
2. exact domain set to `true` returns `true`;
3. wildcard `"*": true` returns `true`;
4. exact domain or wildcard set to `false` does not exempt;
5. missing KV key omits the property;
6. malformed JSON omits the property;
7. `null`, an array, or a non-object value omits the property;
8. any non-boolean map value makes the map invalid and omits the property;
9. a rejected KV read omits the property;
10. the existing CSS response and unknown-feature behavior are unchanged.

Run and observe the new cases fail:

```bash
pnpm test:unit tests/unit/feature-flags.spec.ts
```

### Green

Add one dedicated handler that reads `PAYWALL_EXEMPTIONS`. Accept only a plain
JSON object whose values are booleans. For a valid map, assign:

```ts
result.PAYWALL_EXEMPT = exemptions['*'] === true
  || exemptions[clientDomainInQuery] === true;
```

On a missing value, parse/schema error, or KV exception, log through the
endpoint's existing error path and leave the result property absent. Do not
default it to `false` in a catch/finally block.

Wire the handler only for `PAYWALL_EXEMPT` (and the endpoint's existing
`queryAll` mode). Keep `handleCustomerSuccessService` byte-for-byte where
practical. `/feature-flags` is already in `public/_routes.json`; do not add a new
route or endpoint.

Re-run the test and commit:

```bash
pnpm test:unit tests/unit/feature-flags.spec.ts
git add functions/feature-flags.ts tests/unit/feature-flags.spec.ts
git commit -m "feat(paywall): expose exemption decision"
```

## Task 4: Resolve the fixed Lite policy in the composable

**Files:**

- Modify `src/composables/useCustomerSuccessService.ts`
- Modify `src/composables/useCustomerSuccessService.spec.ts`
- Modify `src/composables/useCustomerSuccessService.failopen.spec.ts`
- Modify `tests/unit/useCustomerSuccessService.spec.ts`
- Modify comments/tests in `src/utils/paywall/warningBanner.ts` and
  `src/utils/paywall/warningBanner.spec.ts` only where needed to describe the
  legacy marker field accurately

### Red

Update the feature-flag mocks to use `PAYWALL_EXEMPT`, then pin these outcomes:

| Variant / response | Policy source | Effective paywall |
|---|---|---|
| Lite, `{ PAYWALL_EXEMPT: false }` | `default_on` | enabled |
| Lite, `{ PAYWALL_EXEMPT: true }` | `exemption` | disabled |
| Lite, `{}` or rejected call | `fail_open` | disabled |
| non-Lite | `fail_open` compatibility state | disabled; no exemption request |

Also assert:

- default-on Lite warns at 85 and blocks at 100 with an unpaid space;
- an exemption disables both warning and blocking at the same counts;
- user- and space-license grants still override a default-on decision;
- macro-count read failures retain the existing fail-open behavior;
- `mockCSSEnabled=true` maps to effective default-on and
  `mockCSSEnabled=false` maps to effective exemption for test/dev use;
- the page-banner marker's legacy `customerSuccessServiceEnabled` field stores
  the effective boolean (`true` only for `default_on`), preserving old marker
  parsing and eventual consistency;
- Full/non-Lite initialization neither calls `/feature-flags` for
  `PAYWALL_EXEMPT` nor blocks, regardless of count and mock paid state.

Run the focused tests and confirm the new expectations fail:

```bash
pnpm test:unit \
  src/composables/useCustomerSuccessService.spec.ts \
  src/composables/useCustomerSuccessService.failopen.spec.ts \
  tests/unit/useCustomerSuccessService.spec.ts \
  src/utils/paywall/warningBanner.spec.ts
```

### Green

Add one `PaywallPolicySource` ref initialized to `fail_open`. Replace the old CSS
lookup with a Lite-only policy load:

```ts
if (!isLite) {
  // Leave the effective paywall disabled and do not request the new feature.
} else {
  const flags = await getFeatureFlagsForCurrentDomain(['PAYWALL_EXEMPT']);
  if (typeof flags.PAYWALL_EXEMPT !== 'boolean') {
    policySource.value = 'fail_open';
    paywallEnabled.value = false;
  } else if (flags.PAYWALL_EXEMPT) {
    policySource.value = 'exemption';
    paywallEnabled.value = false;
  } else {
    policySource.value = 'default_on';
    paywallEnabled.value = true;
  }
}
```

Use the effective boolean in the existing `actionRequired`,
`shouldBlockActions`, and targeting-marker expressions. Preserve the current
85/100 constants, paid-space precedence, macro-count behavior, and parallel
initialization. Mark an unavailable lookup as loaded for the iframe lifecycle;
do not retry it into a surprise mid-session restriction.

Return the source ref as `paywallPolicySource`. Keep the existing `cssEnabled`
return member as an alias of the effective boolean until saved Mixpanel queries
and old consumers have migrated. Reset both values in `__resetForTests`.

Do not change `src/apis/featureFlags.ts`; its existing empty-object failure
contract is exactly what the composable turns into `fail_open`.

Re-run the focused tests and commit:

```bash
pnpm test:unit \
  src/composables/useCustomerSuccessService.spec.ts \
  src/composables/useCustomerSuccessService.failopen.spec.ts \
  tests/unit/useCustomerSuccessService.spec.ts \
  src/utils/paywall/warningBanner.spec.ts
git add src/composables/useCustomerSuccessService.ts \
  src/composables/useCustomerSuccessService.spec.ts \
  src/composables/useCustomerSuccessService.failopen.spec.ts \
  tests/unit/useCustomerSuccessService.spec.ts \
  src/utils/paywall/warningBanner.ts \
  src/utils/paywall/warningBanner.spec.ts
git commit -m "feat(paywall): default Lite policy to on"
```

If the warning-banner files require no semantic or wording correction after the
composable change, leave them out of the commit rather than manufacturing churn.

## Task 5: Emit the policy source on the existing gate event

**Files:**

- Modify `src/utils/paywall/mountPaywallGate.ts`
- Modify `src/utils/paywall/mountPaywallGate.spec.ts`

### Red

Extend the fake customer-success service with `paywallPolicySource`. Assert the
existing `paywall_gate_evaluated` event carries each of the three values:

- a blocking default-on decision reports `default_on`;
- a non-blocking explicit exemption reports `exemption`;
- a non-blocking unavailable decision reports `fail_open`.

Keep assertions that `css_enabled` is still present and that non-Lite mounts emit
no gate-evaluated event.

```bash
pnpm test:unit src/utils/paywall/mountPaywallGate.spec.ts
```

### Green

Add only this property to the existing payload:

```ts
paywall_policy_source: customerSuccess.paywallPolicySource.value,
```

Do not add another event or emit on Full, Diagramly, or AsyncAPI.

```bash
pnpm test:unit src/utils/paywall/mountPaywallGate.spec.ts
git add src/utils/paywall/mountPaywallGate.ts \
  src/utils/paywall/mountPaywallGate.spec.ts
git commit -m "feat(analytics): report paywall policy decisions"
```

## Task 6: Update operational tooling and public guidance

**Files:**

- Add `.claude/skills/paywall/scripts/paywall_exemptions.py`
- Add `.claude/skills/paywall/scripts/test_paywall_exemptions.py`
- Modify `.claude/skills/paywall/scripts/css_flag.py` documentation only
- Modify `.claude/skills/paywall/scripts/paywall_queries.py` help/comments only
- Modify `.claude/skills/paywall/SKILL.md`
- Modify `.claude/skills/pvt-paywall/SKILL.md`
- Modify `.claude/skills/repro/SKILL.md` where it describes the legacy mock
- Modify `docs/features/paywall.md`
- Modify `docs/policies/client-privacy.md`

Build a small wrapper patterned after `css_flag.py`, with this interface:

```text
paywall_exemptions.py --environment staging get
paywall_exemptions.py --environment production get
paywall_exemptions.py --environment <staging|production> put '<json>'
```

Requirements:

- select the existing `KV_FEATURE_FLAGS` namespace ID from the checked-in
  staging/production configuration;
- always pass Wrangler `--remote`;
- require the environment argument so a write cannot silently target prod;
- validate reads and writes as a JSON object with boolean values only;
- reject arrays, null, strings, numbers, and any mixed-value object before
  invoking a write;
- use exactly the key `PAYWALL_EXEMPTIONS`;
- leave stderr visible so authentication prompts/errors are not swallowed;
- perform no write in tests; mock `subprocess.run` and assert the exact command.

Keep the interface at read/put. Do not grow it into an exemption policy manager.
The operator can perform one reviewed read-modify-write when adding/removing the
wildcard or a domain, followed by a separate read-back verification.

Rewrite the paywall skill's live semantics:

- absent from `PAYWALL_EXEMPTIONS` means Lite default-on;
- exact `true` means tenant exemption;
- wildcard `true` means fleet rollback;
- CSS is snapshot enrollment only and `-x-` is a migration artifact, not the
  new disable mechanism;
- the daily table starts from domains that emitted `paywall_triggered` (plus
  related paywall lifecycle events) in the requested window, then removes
  explicit exemptions and internal sites;
- do not enumerate every Lite installation and do not treat generic save-only
  domains as an enrollment queue;
- a trigger from an exempt domain is an anomaly after allowing for cached old
  bundles;
- the A/B section uses explicit exemptions as controls only when they are
  genuinely comparable; otherwise report that there is no credible control;
- rollout checks query `paywall_gate_evaluated.paywall_policy_source` and keep
  activation signals separate from paid outcomes.

Update `paywall_queries.py` wording from “CSS domains” to “selected active
paywall domains” without changing its network/query behavior. Update
`css_flag.py`'s header to state that it manages snapshot enrollment and legacy
records, not the effective paywall. Update the PVT/repro instructions to explain
that `mockCSSEnabled` is retained as an effective decision override despite its
legacy name.

Update `docs/features/paywall.md` so the code map, flow, and rollout mechanism
describe Lite default-on plus `PAYWALL_EXEMPTIONS`, while retaining CSS in the
snapshot documentation. Do not rewrite historical design specs.

Test the helper without contacting Cloudflare:

```bash
python3 .claude/skills/paywall/scripts/test_paywall_exemptions.py
python3 -m py_compile \
  .claude/skills/paywall/scripts/paywall_exemptions.py \
  .claude/skills/paywall/scripts/css_flag.py \
  .claude/skills/paywall/scripts/paywall_queries.py
python3 .claude/skills/paywall/scripts/paywall_exemptions.py --help
```

Commit the operational changes:

```bash
git add .claude/skills/paywall .claude/skills/pvt-paywall \
  .claude/skills/repro/SKILL.md docs/features/paywall.md \
  docs/policies/client-privacy.md
git commit -m "docs(paywall): operate default-on exemptions"
```

## Task 7: Prove snapshot enrollment stayed CSS-only

Do not modify snapshot production code. Run the existing regression tests whose
exact KV-key assertion proves the snapshot path still reads
`CUSTOMER_SUCCESS_SERVICE`:

```bash
pnpm test:unit \
  functions/metrics-cache/snapshot/common.spec.ts \
  functions/metrics-cache/snapshot/service.spec.ts \
  src/macro-count-snapshot.spec.ts
```

Inspect the final diff and confirm there is no change under
`functions/metrics-cache/snapshot/` or `src/macro-count-snapshot.ts`. If a test
needs changing only because a shared mock was renamed, keep its assertion on the
literal CSS key and explain why in the commit; otherwise make no snapshot commit.

## Task 8: Full local validation

Run focused coverage first:

```bash
pnpm test:unit \
  tests/unit/feature-flags.spec.ts \
  src/composables/useCustomerSuccessService.spec.ts \
  src/composables/useCustomerSuccessService.failopen.spec.ts \
  tests/unit/useCustomerSuccessService.spec.ts \
  src/utils/paywall/mountPaywallGate.spec.ts \
  src/utils/paywall/warningBanner.spec.ts \
  functions/metrics-cache/snapshot/common.spec.ts \
  functions/metrics-cache/snapshot/service.spec.ts \
  src/macro-count-snapshot.spec.ts
```

Then run repository-level regression coverage:

```bash
pnpm test:unit
pnpm lint
pnpm build:lite
pnpm build:full
pnpm build:diagramly
pnpm build:asyncapi
git diff --check origin/main...HEAD
```

The four builds are compilation/regression coverage. They do not authorize a
Full, Diagramly, or AsyncAPI paywall rollout.

Run the public-repository discovery command from
`docs/policies/client-privacy.md`. The repository has historical baseline hits;
compare against `origin/main` and require zero new client identity in this diff.
Also search the feature diff for accidental policy expansion:

```bash
git diff origin/main...HEAD -- src functions \
  | rg 'LEGACY_FREE|percentage|rolloutMode|CUSTOMER_SUCCESS_SERVICE'
```

Expected: no Full/Legacy Free or generic rollout implementation; CSS may appear
only in compatibility comments/tests, not as the new gate input.

## Task 9: Open, validate, and land the implementation PR

Use the repository's established branch workflow. The PR description must state:

- Lite changes from allowlisted-on to default-on;
- missing/invalid exemption data is fail-open;
- CSS snapshot enrollment is unchanged;
- `css_enabled` remains temporarily for saved-query compatibility;
- Full/Diagramly/AsyncAPI behavior is unchanged;
- production stays inert behind wildcard until a separate activation step.

Keep real exemptions and tenant rationale out of the public PR. Wait for the
surviving `pull_request` workflow on the head SHA; a cancelled duplicate `push`
run is expected. Land only after unit/build/E2E jobs are green and after rebasing
on the merged purchase-surface prerequisites.

The main workflow deploys all variants to staging as regression coverage. That
does not expand the product scope and must not be followed by a Full production
release.

## Task 10: Stage the configuration and capture UI evidence

This task mutates staging KV and drives Confluence UI. Use the paywall and
spot-check workflows and write the assertions before opening the browser.

1. Read the staging map with `paywall_exemptions.py`; if missing, seed it with
   `{"*": true}`. Read it back and call the staging `/feature-flags` endpoint to
   verify `PAYWALL_EXEMPT: true` rather than an omitted property.
2. With the released staging bundle, verify a Lite iframe emits
   `paywall_gate_evaluated` with `paywall_policy_source: exemption` while the
   wildcard is present.
3. In a controlled window, remove the wildcard and the internal staging domain
   from the staging map, retaining any other entries. Read back the map and
   verify the endpoint returns `PAYWALL_EXEMPT: false`.
4. On a Lite staging editor, set only the existing count/paid mocks
   (`mockMacroCount=105`, `mockSpacePaid=false`); do not set
   `mockCSSEnabled`, because this assertion must traverse the real exemption
   lookup. Open an edit/create path and capture a screenshot showing the real
   paywall modal inside the Forge iframe. Intercept analytics and assert
   `paywall_policy_source: default_on` and `gate_fired: true`.
5. Add the staging domain as an explicit exemption, read back the KV and endpoint,
   reload a fresh iframe, and capture the editor opening without the modal.
   Assert `paywall_policy_source: exemption` and `gate_fired: false`.
6. Restore `{"*": true}` in staging after the test so unrelated staging work is
   not left gated.
7. Against `zenuml-full@stg`, arrange a 105/unpaid local state, listen for
   `/feature-flags` requests, and open the same editor path. Capture UI evidence
   that the Full editor opens, assert no request includes `PAYWALL_EXEMPT`, and
   assert no `paywall_gate_evaluated` event is emitted.

Use Playwright for every UI assertion because the app is inside a cross-origin
Forge iframe. Store screenshots and any tenant-bearing trace only in ignored
spot-check artifacts. If a UI assertion cannot be driven, mark it `SKIPPED` with
the exact blocker; unit tests are not substitute evidence.

## Task 11: Prepare an inert production rollout

Do not begin until all of these are true:

- PRs #407 and #408 are merged and their purchase surfaces are visibly live;
- the implementation PR is merged and main CI/staging validation is green;
- the staging default-on/exemption/Full assertions above have UI evidence;
- the user has explicitly authorized production KV mutation and release.

Initialize the `private/` submodule only now. Build the production exemption map
from the private runbook and live state without copying it into a public file:

1. translate each current CSS `-x-` soft-disable to its verified real domain;
2. include every current private do-not-enroll commitment;
3. record each real-domain reason, owner, and review date in
   `private/paywall/runbook.md` in a private-repo commit;
4. add `"*": true` to the production map;
5. write the complete boolean-only object with the helper and immediately read
   it back;
6. verify the production endpoint returns `PAYWALL_EXEMPT: true` for a harmless
   placeholder domain while the wildcard is present.

Do not derive real domains by blindly deleting `-x-`; verify each mapping from
private records. Do not print the resulting map in a public issue, PR, release
note, or checked-in shell transcript.

Release the unchanged-policy canary required by the repository pipeline, then
Lite for the same commit:

1. release Diagramly only if required to satisfy the same-SHA Lite prerequisite;
   its `isLite() === false` path makes this a regression canary, not a paywall
   activation;
2. release Lite;
3. do not release Full or AsyncAPI in this rollout;
4. run Lite PVT and the targeted paywall spot check;
5. while the wildcard remains, verify production events from the new Lite bundle
   report `paywall_policy_source: exemption`, not `fail_open`.

If the new bundle reports `fail_open`, stop. Fix the key/binding/read path while
the wildcard remains; do not remove it merely because users are currently
unblocked.

## Task 12: Activate Lite, monitor, and retain a one-command rollback

Activation is the single production read-modify-write that removes only the
wildcard and retains every domain exemption. Show the reviewed before/after key
set to the user without exposing it in public artifacts, obtain the final
go/no-go, write it, then read it back.

Immediately verify:

- production `/feature-flags` returns `PAYWALL_EXEMPT: false` for an unlisted
  placeholder domain;
- it returns `true` for one explicit exemption selected privately;
- new Lite `paywall_gate_evaluated` events contain `default_on`;
- explicit exemptions produce `exemption` and no new triggers after allowing
  for old cached bundles;
- `fail_open` does not spike;
- Full, Diagramly, and AsyncAPI produce no new gate-event volume;
- the snapshot job still reads only CSS enrollment.

Monitor at 15 minutes, 1 hour, and 24 hours, then use the existing seven-day
rollout-shock and four-week edit-momentum framework. Report activation signals
separately from outcomes: trigger breadth, continue/exhaustion, advocacy and
purchase CTA activity, extension requests, save/create momentum, and both
payment rails. A `default_on` event is not a conversion.

Rollback on a configuration/read anomaly, unexpected exempt-tenant trigger,
support spike, edit/create regression, purchase-surface failure, or non-Lite
behavior change. Rollback is:

1. read the current production map;
2. add `"*": true` without deleting domain entries;
3. write and read back the map;
4. verify the endpoint returns `PAYWALL_EXEMPT: true`;
5. verify a fresh Lite iframe reports `exemption` and opens ungated.

An already-open modal and an already-persisted page-banner marker may survive
until iframe/page refresh. Do not add a second runtime lookup to eliminate that
eventual-consistency window.

## Deferred follow-up

Full Legacy Free remains a separate product/design task. Do not reuse this
implementation plan to turn it on: it needs its own license-state evidence,
copy, analytics contract, rollout, and approval.
