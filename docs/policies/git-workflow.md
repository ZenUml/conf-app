# Git Workflow Policy

## Never commit directly to `main`

Always create a feature branch for new work.

**Exception:** Changes to `.md` files only (docs, CLAUDE.md, README, etc.) may be committed directly to `main`.

## When you do NOT need a worktree (or a branch)

A worktree is only ever needed to keep two *working trees* from colliding. Don't reach for one reflexively:

- **`.md`-only changes** go straight to `main` (per the exception above) — no feature branch. If your current tree is clean, just `git checkout main && git pull`, commit, push. Only spin up a worktree if the current tree holds **another session's** uncommitted changes (see below) that block a clean `git checkout main`.
- **Git-ignored files only** (e.g. copied `.env`/auth-state, local `node_modules`, scratch screenshots): there is nothing to commit at all — no branch, no worktree, no PR.

In short: create a worktree when you need an isolated *checkout* — to avoid disrupting another session's dirty tree, or to run two branches at once. Not for trivial docs or untracked local files.

## Starting work on an issue

Check the current branch state first:

**If on `main`:**
```bash
git checkout -b <feature-branch-name>
```

**If on a different feature branch:**
1. Check if the branch is clean: `git status`
2. **If clean** — switch back to main, pull, then create the new branch:
   ```bash
   git checkout main && git pull && git checkout -b <feature-branch-name>
   ```
3. **If dirty (uncommitted changes)** — stop and present these options:
   1. Commit the current changes first, then switch to the new branch
   2. Use a git worktree so both branches can coexist: `git worktree add ../conf-app-<feature> -b <feature-branch-name>`

Always use the `/superpowers:using-git-worktrees` skill when choosing option 2.

## Collaboration ground rules — never disrupt another session's working tree

The working tree is shared state. Another Claude session, or the user themselves, may have **uncommitted in-flight changes** on the current branch. Those changes are unfinished work that belongs to whoever started them.

**The rule:** if `git status` shows uncommitted changes you didn't make, you MUST NOT do any of the following:
- `git checkout <other-branch>` — this drags the uncommitted changes onto the other branch, polluting someone else's work and (worse) leaving the original branch looking "clean" when it isn't.
- `git reset --hard`, `git restore --staged --worktree`, `git clean -fd` — these destroy the other session's work outright.
- `git stash` of someone else's changes — same effect; the owner doesn't know to look there.

**What to do instead:** create a NEW branch from where you actually need to work (typically `main`), using a git worktree so the existing branch's working tree is left exactly as you found it:
```bash
git worktree add ../conf-app-<your-feature> -b <your-feature-branch> main
cd ../conf-app-<your-feature>
```
Do your work in the worktree; the original directory stays untouched.

**Detection signal:** uncommitted changes you didn't make in this session. The unambiguous tell is files that don't appear in your own conversation history yet show as `M`/`A`/`??` in `git status`. When in doubt, ASK the user before any destructive or branch-switching operation.

**Why this rule exists:** a prior session wiped hours of in-flight implementation work by checking out a new branch on top of uncommitted edits, then later resetting — both legitimate-looking git operations that together silently destroyed the other session's work.
