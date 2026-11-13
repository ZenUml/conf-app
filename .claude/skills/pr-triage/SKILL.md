---
name: pr-triage
description: Manually resolve a conf-app PR's E2E test triage, with evidence for a subset or current-commit full-suite approval.
disable-model-invocation: true
---

# PR Test Triage

For state transitions, record validation and CI enforcement, read [PR test-decision policy](../../../docs/policies/pr-test-decisions.md).

Run only when the user explicitly requests PR test triage. This is the E2E scope queue; issue intake and external-PR intake use their existing triage flow. Use existing GitHub authentication and the current agent's analysis, with no new model-provider API call.

## Trusted helper checkout

Analyze the candidate diff in its feature checkout. Run `inspect`, `publish` and `request-pr-e2e` from a separate clean checkout of the trusted default branch, including for manual full decisions on catalog-changing PRs. The helper stamps its local catalogs; invoking the candidate's helper would publish candidate fingerprints that the trusted controller rejects. Do not pass candidate hashes as a workaround.

Prepare the helper checkout without running candidate setup:

```bash
git fetch origin main
trusted_controller_sha=$(git rev-parse origin/main)
trusted_controller_dir=$(mktemp -d "${TMPDIR:-/tmp}/conf-app-pr-controller.XXXXXX")
git worktree add --detach "$trusted_controller_dir" "$trusted_controller_sha"
```

Use `node "$trusted_controller_dir/scripts/test-selection/pr-decision.mjs" ...` and `node "$trusted_controller_dir/scripts/test-selection/request-pr-e2e.mjs" ...` for the commands below. Keep decision JSON at an absolute path. After completion, remove the clean helper checkout with `git worktree remove "$trusted_controller_dir"`. If the default branch lacks this policy version, report the bootstrap blocker; do not execute candidate authorization code instead.

## Select and investigate

Use the PR named by the user. For a queue request, list the queue and process only the requested scope:

```bash
gh pr list --repo ZenUml/conf-app --state open --label test:triage --json number,title,headRefName,isDraft
node "$trusted_controller_dir/scripts/test-selection/pr-decision.mjs" inspect --pr <PR_NUMBER> --repo ZenUml/conf-app
```

Read the latest decision and its unresolved reason, the complete current diff, affected callers and test contracts. Bind the investigation to the inspection's current head and base. Determine which behaviors and variants can change, and which tests exercise them. Read root [IMPACT-MAP.md](../../../IMPACT-MAP.md), the affected Feature contracts, Interface boundaries and assertion-backed test scenario tags. Check every changed path; earlier approvals are evidence to inspect, not permission to reuse.

## Resolve

Choose one outcome:

- **Subset:** `mode: selected`. Preserve smoke, directly changed E2E specs and known dependency selectors. Explain why the explicit `{feature, interface}` pairs cover the affected behaviors and have registered E2E coverage in the applicable variant/suite. A justified smoke-only result can have no added categories.
- **Full approved:** `mode: all`. Name the affected behaviors and explain in `full_reason` why a smaller test set cannot cover them. Shared-path rules, unknown paths, missing model output and an earlier full approval are insufficient reasons by themselves.
- **Unresolved:** `mode: triage`. State the missing evidence or decision and keep E2E blocked and the PR Draft.

Use the inspected `decision_template`, set `source: triage`, and retain its identity fields. Add `reason` and `evidence` entries (`paths`, `reason`, `scenarios`) covering every changed filename. Use schema v2 and registered exact pairs in `scenarios`; keep axis fields, match pairs atomically, and never expand dimension labels into combinations. Keep customer names and secrets out of the public record.

Write the JSON file, then publish it:

```bash
node "$trusted_controller_dir/scripts/test-selection/pr-decision.mjs" publish --pr <PR_NUMBER> --repo ZenUml/conf-app --file <DECISION_JSON>
```

Publication creates a new comment; edited comments cannot authorize tests. The helper validates collaborator permission and the current head/base, then reconciles labels. A stale result requires fresh investigation. Every new push requires a new decision; full coverage returns to manual triage each time.

## Retain the lesson

Before closing resolved triage, update IMPACT-MAP.md with the reusable product relation, caller/dependency boundary and source evidence that made the decision possible. Update the relevant test's literal `@feature:`, `@interface:` and `@scenario:feature:interface` tags only when its assertions cover that pair; check the derived coverage inventory in `tests/e2e-tests/config/scenario-coverage.mjs` (it reads literal metadata without executing tests). Record infrastructure/retired journeys as unclassified rather than inventing product coverage. Run the map/metadata policy checks. Keep source-confirmed wiring and actual UI verification distinct; preserve pending UI questions explicitly.

Map and coverage changes invalidate older decisions. Subset decisions require the maintained catalog to be available in the trusted controller. For a catalog-changing PR, explicitly requested manual triage may approve full coverage for the current commit against the existing trusted catalog; the candidate runs its complete configured inventory and retains the controller fingerprints. This is the reviewed catalog upgrade path; candidate metadata cannot authorize a new subset. If the lesson cannot be verified, leave the specific gap in triage rather than claiming the map is complete.

## Execute and finish

For an executable result, request a fresh PR-associated validation run:

```bash
node "$trusted_controller_dir/scripts/test-selection/request-pr-e2e.mjs" --pr <PR_NUMBER> --repo ZenUml/conf-app
```

The helper validates the current executable decision and requests a PR event through GitHub. CI checks the decision again; the request itself grants no coverage permission. Use this helper rather than editing a request label or dispatching the workflow on `main`.

Keep the PR's Draft state; resolving test scope does not mark work Ready for Review. If monitoring was requested, use `babysit-pr` for the matching commit and preserve its bounded retry rules.

Report the PR URL, commit, outcome, supporting decision comment and planned tests. Distinguish a published plan from executed E2E evidence. For unresolved triage, give the concrete remaining blocker. Do not turn a GitHub or tooling failure into full-suite approval.
