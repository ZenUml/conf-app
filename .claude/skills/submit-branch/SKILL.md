---
name: submit-branch
description: Push the current branch and create or reuse a PR on ZenUml/conf-app. Use when the user says "submit", "create PR", "push and PR", "open a pull request", "submit branch", or wants to publish their work as a PR without merging. Classify its E2E scope with pr-labeling, then babysit executable CI; unresolved scope enters manual test triage. Does not merge — use land-pr for that.
---

# Submit Branch

Publish the current branch as a Draft pull request on `ZenUml/conf-app`, decide its E2E scope with `pr-labeling`, then babysit executable CI. Reuse an existing PR for the branch.

**Tip:** Run `/validate-branch` first to catch lint, test, and build failures before pushing.

## Preconditions

The worktree must be in a committable state:

- **Clean worktree** — nothing to commit, just push. This is the ideal case.
- **Scoped changes** — all modified files relate to the current work. Stage and commit them.
- **Mixed/unrelated changes** — modified files include unrelated work. **Stop and ask the user** which files to include. Never auto-commit a mixed worktree.

To check: `git status` and review the file list. If in doubt, ask.

## Steps

### 1. Check worktree state

```bash
git status
```

If dirty, evaluate whether changes are scoped (all related to the branch's purpose) or mixed. If mixed, stop and ask.

If scoped, stage the relevant files and commit with a descriptive message. Follow the repo's commit conventions (one-line message, Co-Authored-By trailer).

### 2. Push

```bash
git push -u origin <branch-name>
```

Use regular push — never force-push. If push fails due to upstream changes, report the conflict and stop.

### 3. Create or reuse PR

Check if a PR already exists:

```bash
gh pr view --json number,title,url 2>/dev/null
```

If a PR exists, note its URL and proceed to Step 4 to classify the current commit. A new push invalidates the previous test decision.

If no PR exists, create one targeting `main` **as Draft**:

```bash
gh pr create --base main --draft --title "<concise title>" --body-file <PR_BODY_FILE>
```

Every new PR starts Draft. E2E is authorized by a current test decision, independently of Draft status. If the user requested Ready, first create Draft, complete labeling, and only then use `ready-pr` when the decision is executable.

### 4. Label the current commit

Invoke `pr-labeling` with the PR number. It inspects the complete diff, publishes a commit-bound decision and requests a fresh PR-associated validation run for executable decisions.

If the result is `test:triage`, finish the independent build/unit-test checks and report **TRIAGE — E2E blocked** with the reason. Keep the PR Draft. Manual `pr-triage` needs an explicit user request; submission does not invoke it automatically.

### 5. Babysit executable CI

For an executable decision, invoke `babysit-pr` with the PR number. It monitors the matching candidate, diagnoses failures and attempts fixes within its retry budget. E2E can run while the PR remains Draft; a valid decision determines the expected tests.

After every fix push, run `pr-labeling` again before waiting for E2E. A full-suite result returns to manual triage for each new commit.

Skip monitoring only if the user explicitly requested “submit only”, “don't babysit” or “just push”. Labeling still records the scope when creating or updating the PR.

## Output

Report:

- **SUBMITTED** — PR number, URL, branch, Draft/Ready state, current test decision and the babysit result.
- **TRIAGE** — PR URL and commit, why scope is unresolved or requires full coverage, E2E blocked, and independent build/unit-test results.
- **FAILED** — what went wrong (dirty worktree, push conflict, gh error).

## Does NOT

- Run tests or lint before pushing (use `/validate-branch` for that)
- Merge the PR (use `/land-pr` for that)

CI fixing is delegated to `babysit-pr` in Step 5, not done by this skill directly.
