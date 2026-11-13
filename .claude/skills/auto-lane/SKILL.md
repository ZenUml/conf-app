---
name: auto-lane
description: Decide whether an agent session may merge a PR on ZenUml/conf-app without asking (non-destructive rule), and operate the daily auto-lane merge job (classify a diff, dry run, backtest, kill switch). Use when a PR is green and the next step is "merge or ask", when asked "can this be auto-merged", "why did the auto lane skip PR N", "run the auto-lane dry run", "自动合并", "非破坏性", or before proposing any automation that merges.
---

# Auto lane

Rules and their reasons: `docs/policies/auto-lane.md`. Read its "Agent sessions" section before the
first merge of a session. This file holds the commands only.

## Input and output

| Input | Output |
|---|---|
| A PR number | Merge without asking, or offer `[AI] Merge PR #N` with the reason |
| A diff (`base`, `head`) | The daily job's lane and level for it |
| "Why was PR N skipped?" | The job's skip reason from a dry run |

## 1. May the session merge this PR?

```bash
.claude/skills/auto-lane/scripts/classify-pr.sh <PR>     # reads only; needs gh logged in
```

| Result | Action |
|---|---|
| exit 0 | Non-destructive by path, preconditions met: merge (step 2). |
| exit 1, `blockers` not empty | Do not merge. Fix the blocker (CI, draft, conflict) or report it. `mergeable:UNKNOWN` is transient: run again. |
| exit 1, `readDiffFor` not empty | Read those files' diff against the destructive table in the policy. Non-destructive: merge. Destructive: offer `[AI] Merge PR #N` and wait. |
| exit 2 | Fetch or classifier error. Do not merge. |

`jobLevel` is what the daily job would do. It does not bind a session.
The script cannot see what a diff does. A change outside `readDiffFor` that deletes stored data or
publishes a release is still destructive: the path list is a prompt to read, not the rule.

## 2. Merge

Use the `land-pr` skill. Pass `--match-head-commit <head from step 1>` and a merge commit. Then
watch `Build, Test and Draft Release` on `main`. Do not release to production.

## 3. Daily job

```bash
node scripts/ci/auto-lane-merge.mjs --dry-run                 # decisions for every open Dependabot PR
gh workflow run auto-lane-merge.yml                           # same, on GitHub (dry run by default)
node scripts/ci/auto-lane-policy.mjs --base <sha> --head <sha> --json   # lane and level of one diff
gh variable get AUTO_LANE_ENABLED                             # kill switch; anything but "true" is off
```

Setting `AUTO_LANE_ENABLED` changes what merges unattended: do it only on the owner's explicit pick.

## 4. Backtest after a classifier change

For each merged PR in the window, classify `<merge>^1..<merge>^2` and count lanes:

```bash
gh pr list --state merged --base main --limit 300 --json number,mergeCommit \
  --jq '.[]|[.number,.mergeCommit.oid]|@tsv' |
while IFS=$'\t' read -r n sha; do
  node scripts/ci/auto-lane-policy.mjs --base "$sha^1" --head "$sha^2" --json 2>/dev/null |
    jq -c --arg n "$n" '{pr:$n,level,lane}'
done | jq -s 'group_by(.level)|map({level:.[0].level,count:length})'
```

Update the backtest table in the policy when the counts change. A revert commit that classifies
above `report-only` is a false approval: fix the classifier first.
