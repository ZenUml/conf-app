---
name: pr-triage
description: Manually resolve a conf-app PR's E2E test triage, with evidence for a subset or current-commit full-suite approval.
disable-model-invocation: true
---

# PR Test Triage

For state transitions, record validation and CI enforcement, read [PR test-decision policy](../../../docs/policies/pr-test-decisions.md).

Run only when the user explicitly requests PR test triage. This is the E2E scope queue; issue intake and external-PR intake use their existing triage flow. Use existing GitHub authentication and the current agent's analysis, with no new model-provider API call.

## Select and investigate

Use the PR named by the user. For a queue request, list the queue and process only the requested scope:

```bash
gh pr list --repo ZenUml/conf-app --state open --label test:triage --json number,title,headRefName,isDraft
node scripts/test-selection/pr-decision.mjs inspect --pr <PR_NUMBER> --repo ZenUml/conf-app
```

Read the latest decision and its unresolved reason, the complete current diff, affected callers and test contracts. Bind the investigation to the inspection's current head and base. Determine which behaviors and variants can change, and which tests exercise them. Check every changed path; earlier approvals are evidence to inspect, not permission to reuse.

## Resolve

Choose one outcome:

- **Subset:** `mode: selected`. Preserve smoke, directly changed E2E specs and known dependency selectors. Explain why the selected categories cover the affected behaviors. A justified smoke-only result can have no added categories.
- **Full approved:** `mode: all`. Name the affected behaviors and explain in `full_reason` why a smaller test set cannot cover them. Shared-path rules, unknown paths, missing model output and an earlier full approval are insufficient reasons by themselves.
- **Unresolved:** `mode: triage`. State the missing evidence or decision and keep E2E blocked and the PR Draft.

Use the inspected `decision_template`, set `source: triage`, and retain its identity fields. Add `reason` and `evidence` entries (`paths`, `reason`, `categories`) covering every changed filename. Use catalog IDs for selected categories. Keep customer names and secrets out of the public record.

Write the JSON file, then publish it:

```bash
node scripts/test-selection/pr-decision.mjs publish --pr <PR_NUMBER> --repo ZenUml/conf-app --file <DECISION_JSON>
```

Publication creates a new comment; edited comments cannot authorize tests. The helper validates collaborator permission and the current head/base, then reconciles labels. A stale result requires fresh investigation. Every new push requires a new decision; full coverage returns to manual triage each time.

## Execute and finish

For an executable result, request a fresh PR-associated validation run:

```bash
node scripts/test-selection/request-pr-e2e.mjs --pr <PR_NUMBER> --repo ZenUml/conf-app
```

The helper validates the current executable decision and requests a PR event through GitHub. CI checks the decision again; the request itself grants no coverage permission. Use this helper rather than editing a request label or dispatching the workflow on `main`.

Keep the PR's Draft state; resolving test scope does not mark work Ready for Review. If monitoring was requested, use `babysit-pr` for the matching commit and preserve its bounded retry rules.

Report the PR URL, commit, outcome, supporting decision comment and planned tests. Distinguish a published plan from executed E2E evidence. For unresolved triage, give the concrete remaining blocker. Do not turn a GitHub or tooling failure into full-suite approval.
