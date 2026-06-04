---
name: submit-branch
description: Push the current branch and create or reuse a PR on ZenUml/conf-app. Use when the user says "submit", "create PR", "push and PR", "open a pull request", "submit branch", or wants to publish their work as a PR without merging. After the PR exists it always babysits CI (via babysit-pr — monitor + auto-fix). Does not merge — use land-pr for that.
---

# Submit Branch

Publish the current branch as a pull request on `ZenUml/conf-app`, then babysit its CI. Reuses an existing PR if one already exists for this branch.

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

If a PR exists, note its URL and **proceed to Step 4** (babysit it). Do not stop here.

If no PR exists, create one targeting `main` **as Draft**:

```bash
gh pr create --base main --draft --title "<concise title>" --body "$(cat <<'EOF'
## Summary
<bullet points — mention which variant(s) are affected: lite/full/diagramly>

## Test plan
<what was tested>
EOF
)"
```

**Why Draft:** the `Build, Test and Draft Release` workflow skips `E2E: Lite` (the ~10-minute job) on Draft PRs. Iterate on the branch without paying the E2E cost on every push. When you want E2E to run, use `/ready-pr` (verify only) or `/ship-branch` / `/land-pr` (which auto-flip as part of merging).

If the user explicitly says "submit as ready" or "open as ready", omit `--draft`.

### 4. Babysit CI (always)

After the PR exists (created or reused), **always** babysit its CI by invoking the `babysit-pr` skill with the PR number:

```
/babysit-pr <PR_NUMBER>
```

This monitors the `Build, Test and Draft Release` run, diagnoses any failure, and attempts fixes (up to 3 attempts). For a **Draft** PR it expects `Build and Unit Test` + `Deploy: Lite` to pass and `E2E: Lite` to be skipped — that skip is by design, not a failure. Do not stop at "PR created"; carry through until babysit-pr reports PASSED or exhausts its retry budget.

Skip this step only if the user explicitly said "submit only" / "don't babysit" / "just push".

## Output

Report:

- **SUBMITTED** — PR number, URL, branch name, whether it was opened as Draft (note "mark Ready for Review when you want E2E to run"), **and the babysit-pr result** (PASSED / failures + fixes / retries exhausted).
- **FAILED** — what went wrong (dirty worktree, push conflict, gh error).

## Does NOT

- Run tests or lint before pushing (use `/validate-branch` for that)
- Merge the PR (use `/land-pr` for that)

CI fixing is delegated to `babysit-pr` in Step 4, not done by this skill directly.
