---
name: submit-branch
description: Push the current branch and create or reuse a PR on ZenUml/confluence-plugin-cloud. Use when the user says "submit", "create PR", "push and PR", "open a pull request", "submit branch", or wants to publish their work as a PR without merging. Does not fix CI or merge — those are separate skills.
---

# Submit Branch

Publish the current branch as a pull request on `ZenUml/confluence-plugin-cloud`. Reuses an existing PR if one already exists for this branch.

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

If a PR exists, report its URL and stop — nothing more to do.

If no PR exists, create one targeting `master` **as Draft**:

```bash
gh pr create --base master --draft --title "<concise title>" --body "$(cat <<'EOF'
## Summary
<bullet points — mention which variant(s) are affected: lite/full/diagramly>

## Test plan
<what was tested>
EOF
)"
```

**Why Draft:** the `Build, Test and Draft Release` workflow skips `E2E: Lite` (the ~10-minute job) on Draft PRs. Iterate on the branch without paying the E2E cost on every push. When ready to merge, mark the PR Ready for Review (or run `/ship-branch`, which does that automatically) — that triggers a fresh CI run with E2E.

If the user explicitly says "submit as ready" or "open as ready", omit `--draft`.

## Output

Report:

- **SUBMITTED** — PR number, URL, branch name, and that it was opened as Draft (note "mark Ready for Review when you want E2E to run")
- **FAILED** — what went wrong (dirty worktree, push conflict, gh error)

## Does NOT

- Run tests or lint (use `/validate-branch` for that)
- Fix CI failures
- Merge the PR (use `/land-pr` for that)
