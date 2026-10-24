# Jev-driven integration test selection

Date: 2026-10-02
Status: design agreed in conversation; written specification awaiting review

## Objective and scope

Reduce per-change CI work by selecting impacted slow Confluence E2E tests.
Cover Lite, Full, Diagramly and AsyncAPI. Unit tests and local preview checks
continue under their existing rules. Jev is the primary category selector;
deterministic rules provide mandatory coverage and full-suite fallback.
Daily full staging regression supplies complementary evidence, not a new
production release gate. Existing production checks and release order remain.

Existing building blocks: `tests/e2e-tests/config/tags.ts`, `impact-map.mjs`,
`scripts/e2e-select.mjs`, `build-test-deploy.yml`, `e2e-test.yml`,
`staging-deploy.yml`, and `smoke-test.yml`. Current surface/type tags remain
useful descriptions but must not indiscriminately OR all editor/viewer tests
into a type-specific selection.

## Category contract

A versioned, checked-in category catalog is shared by Jev prompts and test
planning. Each entry defines a stable ID, covered behavior, direct dependencies,
positive and negative examples, and applicable variants. Categories describe
behavior, such as `mermaid-render`, `graph-publish`, `editor-type-preference`
and `byline-create`; the exhaustive inventory is produced from existing tests
during implementation, before selection is enabled.

Each live E2E test has one or more behavior-category tags, applicable variants
and an execution tier. Smoke is mandatory for every tested variant. Runtime
duration is collected from reports, not maintained as a manual `slow` tag.
Tests with no valid category or ambiguous applicability prevent narrowed
execution and trigger full coverage. Existing serial groups and project
dependencies are preserved. A changed test must itself run; shared test harness
changes trigger full coverage. Selection cannot bypass environment prerequisites.

## Classification and saved result

Use TypeSafe's official API with an API key in GitHub Actions secrets named
`TYPESAFE_API_KEY`. This is TypeSafe usage billing, separate from OpenAI
subscriptions. No secret is included in artifacts or logs. Send the public PR
diff and category descriptions, excluding private submodule contents, credentials
and customer data. Treat diff text as data, not instructions.

Jev answers one `noul` question per category; multiple categories may apply.
The supported catalog model is selected explicitly, and the returned concrete
model version is recorded. Category definitions and threshold policy are versioned.
Probabilities are evidence, not proof of correctness. Thresholds are calibrated
on reviewed historical changes before activation; uncertainty retains coverage.

The classifier produces `test-selection.json` on every run, including fallback:

```json
{
  "schema_version": 1,
  "pr": 704,
  "base_sha": "...",
  "head_sha": "...",
  "tested_tree": "...",
  "model": "jev-1.13.0",
  "category_version": "v1",
  "policy_version": "v1",
  "mode": "selected",
  "categories": {
    "mermaid-render": { "probability": 0.92, "selected": true },
    "graph-publish": { "probability": 0.07, "selected": false }
  },
  "required": ["smoke"],
  "fallback_reason": null
}
```

The production format also records request outcome, diff completeness, duration,
usage and rules that widened the selection. Upload it as a GitHub Actions
artifact named for run ID and attempt, with 30-day retention. Keep sensitive
raw request bodies out of artifacts. Missing, expired or invalid evidence causes
fresh classification/testing, never inferred success.

## Display versus execution

Publish a table of category probabilities, decisions and fallback reasons in
the Actions summary, with an artifact download link. Sync generated `test:*`
PR labels to selected categories. Reserve `test:all` for the human override;
generated label updates must never remove it. Labels are a display surface,
not the authoritative input for narrowed execution.

Every new commit requires a new classification. Label updates check that the
PR head is still the classified head, so an older job cannot overwrite a newer
result. Human `test:all` additions trigger a fresh full test run even without
a code push. Removing it never cancels an already-running full test run.

A planning job validates the selection file against the current code tree and
catalog, discovers tests through Playwright, and maps selected categories plus
smoke to explicit test identities. It creates `test-plan.json`, recording exact
tests, variants, projects, dependencies, serial groups and shards. Execution
jobs consume this plan, not PR labels or a newly recomputed AI response.
Never silently accept zero smoke tests or nonexistent test identities.

Use only nonempty shards. Balance them using recent duration data when available,
with a deterministic fallback; do not split serial groups or remove required
authentication/setup projects. Publish actual execution outcomes and test IDs
as `test-evidence.json`, along with existing Playwright reports. These artifacts
connect model decisions to the tests actually executed and passed.

## PR, main and reuse

- PRs deploy/test Lite only: existing fast checks plus Lite smoke and selected
  live categories. Other variants retain their main deployment structure.
- Main uses impacted categories for Full, Diagramly and AsyncAPI, plus their
  mandatory smoke. Full's existing sequencing is retained.
- Main may reuse successful Lite PR evidence only when the exact tested tree,
  applicable catalog/policy and required concrete test coverage match. A PR's
  Lite success supplies no evidence for another variant.
- Changed integrated trees are freshly classified. The change range must include
  every integrated change since the valid baseline; no known baseline means full
  coverage. Never classify only the latest merge while ignoring accumulated work.
- Draft metadata names selected/full coverage and links its evidence. Selected
  success must never be presented as complete regression.

## Mandatory rules and degraded operation

Always include smoke. Shared infrastructure changes (manifest, build/deploy,
shared persistence/model and test harness) force full coverage. Unknown or
unmapped changed paths retain the conservative full fallback until their impact
is explicitly represented. A changed E2E test runs itself.

Timeouts, API/auth failures, incomplete diffs, invalid responses, missing categories,
stale tree identity or invalid plans force full coverage with a recorded reason.
Uncertain category answers keep that category selected. AI cannot override
mandatory rules, including human `test:all`. Fork PRs without authorized secrets
use deterministic fallback; do not execute untrusted PR code in a privileged
label-writing context.

## Daily full staging regression and environment ownership

Run daily at 02:00 UTC and support manual dispatch with a target SHA. Capture
one immutable main SHA, deploy all four variants, verify deployed frontend/backend
identity where observable, and run the complete intended live CI suites applicable
to each variant. Nightly selection ignores Jev and always uses full coverage.
Do not confuse all discovered projects with the existing insert-only production
schedule. Define the full live suite inventory explicitly before activation.

Hold shared staging ownership across the entire deploy-and-test transaction.
Every staging writer participates: PR/main runs, daily regression and manually
dispatched staging deployment. Unit/build jobs can run outside ownership. A deploy
job-only lock is insufficient. The transaction boundary and reusable workflow
structure must enforce ownership through the final test without nested acquisition
of the same lock. Do not cancel an active environment owner in favor of a newer run.

The current workflow has branch-based concurrency, not shared staging ownership.
Implementation must account for pending-run replacement and cancelled nightly runs;
lost regression coverage is visible, not treated as success. Lite, Diagramly and
AsyncAPI share a Pages project, so test each variant after its matching deployment
within ownership rather than assuming four concurrently deployed backends remain
independent. Continue with remaining variants when one variant fails; run tests
only where deployment/version checks succeeded.

## Slack notifications

Send daily regression alerts to `#zenuml`, explicitly authorized by the user.
Configure a Slack bot with permission to post and update its own messages in that
channel; store the token in Actions secrets and the verified channel ID in Actions
configuration. Existing scanned workflows have no Slack integration.

Aggregate failures into one message per regression run: target SHA, workflow link,
variant deployment/version/test verdicts, failure names and report links. Alert on
deployment failure, version mismatch, failed tests, timeouts or interrupted/lost
regression coverage. Regular success is silent. Persist the Slack message identity
with run metadata; reruns update the original message with remaining failures or
recovery. Slack delivery failure is visible in Actions and cannot erase the test
verdict. Do not attach PR diff bodies, keys or customer data to messages.

Regression failure is advisory for production releases initially. Existing release
validation remains authoritative; no new exact-SHA nightly gate is introduced.

## Rollout and verification

1. Inventory categories and label all intended live tests. Add classifier, artifacts,
   summaries and PR labels in observation mode; existing selection still executes.
   Replay reviewed historical PRs covering narrow changes, multi-area changes,
   deleted/renamed paths, manifests and shared dependencies.
2. Add staging ownership, daily full four-variant regression and Slack alerts.
   Verify failure continuation, version mismatch handling and recovery updates.
3. Activate Jev selection only after reviewed evaluation establishes acceptable
   category recall and actual potential test-time savings. Introduce explicit plans,
   nonempty shards and exact-tree Lite reuse. Retain an Actions configuration switch
   that restores existing deterministic behavior without a code deployment.

Test catalog completeness, category-to-test mapping, variant filters, changed tests,
full fallback, stale evidence rejection, human override, exact-tree reuse and serial
groups. Validate actual test IDs selected, not only tag strings. Replay evaluations
report missed categories and actual tests, selection fraction, and durations; three
successful initial Jev examples do not establish recall or a safe threshold.

Measure request latency/usage, executed test time, setup overhead, runner queues,
staging ownership wait and workflow critical path separately. Scheduled regression
failures may reveal missing rules but cannot establish every skipped test's correctness
for earlier PR trees. Continue periodic reviewed evaluations after activation.

This is CI tooling, not a new app user feature; observability is in Actions artifacts,
summaries and Slack. No product Mixpanel events are added by this design.
