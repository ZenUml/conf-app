---
name: ready-pr
description: Mark a conf-app PR Ready for Review after validating its current E2E decision, or run its approved E2E scope while keeping it Draft.
---

# Ready PR

Ready for Review is the author's review choice. A current test decision authorizes E2E separately, including on Draft PRs. Marking Ready cannot bypass test triage.

## Steps

1. Resolve the PR from the user's number or the current branch:

   ```bash
   gh pr view --json number,isDraft,headRefName,headRefOid,title,url
   ```

2. Validate and reconcile the current decision:

   ```bash
   node scripts/test-selection/pr-decision.mjs sync --pr <PR_NUMBER> --repo ZenUml/conf-app
   ```

   If there is no executable decision, use `pr-labeling` to inspect the current commit. If it requires triage, report the reason and keep the PR Draft. `pr-triage` runs only on an explicit user request. A manually applied label or previous-commit approval is insufficient.

3. If the user requested review readiness and the current decision is executable, mark Ready:

   ```bash
   gh pr ready <PR_NUMBER> --repo ZenUml/conf-app
   ```

   If the request is only to run E2E, retain Draft and request a fresh PR-associated validation run instead:

   ```bash
   node scripts/test-selection/request-pr-e2e.mjs --pr <PR_NUMBER> --repo ZenUml/conf-app
   ```

4. Invoke `babysit-pr` for the matching current-commit run unless the user explicitly asked to skip monitoring. An executable subset or approved full decision determines the E2E expectations; Draft state does not.

Report the PR URL, Draft/Ready state, current decision, and actual build/unit-test/E2E results. This skill does not merge or publish commits.
