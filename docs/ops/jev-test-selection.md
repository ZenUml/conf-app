# Jev test selection and daily regression

PR classification now requests `--mode enabled`. Successful trusted decisions
run **smoke + Jev-selected categories + the existing deterministic mapped tags**.
PR discovery covers all normal live Lite projects plus the render project, so
selected categories outside the old insert/render/graph scopes can run too.
Variant applicability still applies: Full-only tests run in the Full main/daily
lanes, not against the Lite PR deployment. The graph-only PR lane is skipped
because its tests are included in the expanded live lane; main keeps its layout.
The deterministic tags remain a coverage floor: Jev cannot remove tests that the
previous selector would run. Shared or unmapped changes, human `test:all`, API
failure, missing artifacts, malformed decisions, or stale tree/policy metadata
run the full normal suite. Main and daily regression also retain full coverage.

The policy is `v2-guarded-uncalibrated`. Category recall and time savings have not
been established; the 0.1 probability threshold is provisional. The floor makes
activation conservative and may limit savings. Removing that floor requires a
reviewed catalog evaluation across representative narrow, multi-area, shared,
renamed and deleted changes, including missed categories, concrete test IDs and
observed durations. Three successful examples are not calibration.

Classifier and resolver code execute from the trusted PR base. The activation
PR itself therefore runs full coverage; subsequent PRs use the new policy.
`TEST_SELECTION_MODE` is reserved and has no effect. To restore observation,
change the workflow classifier mode to `observe`; the resolver then fails full.

Slack integration is deferred at the user’s request. No workflow sends Slack
messages. Regression verdicts are available in the Actions summary and
`regression-results-<run-id>-<attempt>` artifact.

## Actions configuration

- `TYPESAFE_API_KEY`: Actions secret containing the TypeSafe API key. Requests use
  TypeSafe usage billing, separate from an OpenAI subscription. Never publish the
  key or raw request bodies in artifacts. Missing access falls back to full tests.
- `TEST_SELECTION_MODE`: reserved; not read by the current workflows.
The following Slack settings are reserved for a later integration; they are not
required by the current pipelines.

- `SLACK_BOT_TOKEN`: Actions secret containing a Slack bot token authorized to post
  and update its own messages in `#zenuml`.
- `SLACK_CHANNEL_ID`: Actions variable containing the verified channel ID for
  `#zenuml`; a display name is insufficient.

Create or reuse an authorized Slack app with the bot `chat:write` scope, install
it into the workspace, and invite the bot into `#zenuml`. Verify the channel ID
from Slack channel details or the authorized Slack API before configuring the
variable. Configuration alone does not prove a successful connection. Do not
send live local test messages; unit tests mock the Slack API. A meaningful failed
regression is the first delivery verification. Delivery errors fail the
notification step visibly and do not replace the regression verdict.

## Review evidence and force full coverage

The Actions artifacts contain `test-selection.json` (model decisions, mode and
fallback), `test-plan.json` (concrete test identities and shards), and
`test-evidence.json` (actual execution outcomes and source tree). Selection
artifacts are retained for 30 days and named with run ID and attempt. Consult the
run's artifacts and summary to connect the proposal with the tests executed.
Generated `test:*` PR labels display decisions; the artifact is authoritative.
Add the human-owned `test:all` label to a PR to request full coverage even without
a new commit. Generated updates must preserve that label. Removing it does not
cancel a running full test run.

Daily staging regression runs at 02:00 UTC and supports manual dispatch with a
fixed target SHA. It deploys and tests the four variants under shared staging
ownership, with full coverage of the normal staging suites regardless of Jev. Variant failures do
not stop the remaining transactions. Initially its verdict is advisory for
production release; existing release validation and ordering remain authoritative.

The on-demand Lite-to-Full converted-page gate uses a separate Playwright config
and is outside the daily matrix: its `lite2full-render` category currently has
no scheduled tests. The byline activation experiment is also excluded from the
normal insert project unless its opt-in environment flag is set. Catalog tags
describe these ad hoc tests without making them nightly coverage.

## Deferred notification result and recovery contract

The notifier module is implemented and unit tested, but not connected to CI.
When Slack work resumes, use trusted CI code:

```sh
node scripts/test-selection/notify.mjs --results regression-results.json --metadata slack-message.json
# On another attempt of the same run, restore the previous metadata artifact:
node scripts/test-selection/notify.mjs --results regression-results.json --metadata slack-message.json --previous previous-slack-message.json
```

Results contain `run_id`, numeric `attempt`, `sha`, `url`, and a nonempty `variants`
array. Each variant has `variant`, `deployment`, `version`, `tests`, and `failures`.
Each status is `success`, `failure`, `skipped`, or `cancelled`. A failure entry is
a name string or `{ "name": "failure name", "url": "https://..." }`; optional
`report_url` links the variant report. Include interrupted or lost coverage as a
non-success status so it remains visible. Do not include credentials, customer
data or PR diff bodies.

Any non-success verdict or failure entry creates one aggregate alert. Ordinary
success is silent and needs no Slack credentials. Metadata contains
`schema_version`, `run_id`, `attempt`, `sha`, and `status` (`failure`, `recovered`,
or `silent`); delivered messages also contain `channel` and `ts`. Persist it as a
run artifact and restore the latest successful notification metadata on reruns.
An existing timestamp makes the next attempt update the same message with
remaining failures or recovery. The notifier rejects metadata from another run,
SHA or channel. Slack request timeout is 15 seconds. HTTP, transport and API
rejections produce a failing exit code without logging token or response bodies.

Run local verification with:

```sh
pnpm exec vitest run tests/unit/testSelectionNotify.spec.ts
```
