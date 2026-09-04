# Git Workflow Policy

## Never commit directly to `main`

Always create a feature branch for new work.

**Exceptions** — these may be committed directly to `main`:

1. **`.md`-only changes** (docs, CLAUDE.md, README, etc.).
2. **Agent-skill changes confined to `.claude/skills/**`** — *any* file type, including the helper scripts (`.py`, `.mjs`, `.sh`) that sit beside a `SKILL.md`. A skill is agent tooling, not shipped product code: it can't break a build or reach a customer, and both CI triggers `paths-ignore` `.claude/**`, so a branch + PR buys **zero** verification signal — only ceremony. Validate the same way you would on a branch (`python3 -m py_compile`, a `--dry-run`, `--help`) and commit.

Both exceptions require the change to be **confined** to those paths. The moment a commit also touches `src/`, `functions/`, `manifest.yml`, tests, or config, it is a normal code change → feature branch, even if most of the diff is a skill.

## The primary checkout stays on `main`

`/Users/pengxiao/workspaces/zenuml/conf-app` — the primary checkout — stays on `main`. Feature work
goes in a worktree beside it (`../conf-app-<feature>`), never in the primary directory.

**Why:** a branch can only be checked out in one worktree at a time. On 2026-08-31 the primary
directory sat on a feature branch while a worktree created 2026-08-23 (235 commits behind) held
`main`, so `git switch main` failed with `fatal: 'main' is already checked out at
'…/conf-app-agent-link-auth-discussion'`. Pinning `main` to the primary checkout removes that class
of failure, and puts the two direct-to-`main` exceptions above in the directory you are already in.

**Setup cost per new worktree** (measured 2026-08-31, disk figures corrected 2026-09-01 — nothing here is automated yet):

1. `pnpm install` — cheap on disk, and the cost is not what `du` reports. pnpm 10 imports packages
   from the store with APFS `clonefile` (copy-on-write): every file gets its own inode with a link
   count of 1, so `du` counts each worktree's copy in full while the physical blocks stay shared.
   Measured 2026-09-01: a `node_modules` that `du` reports as 2.3 GB costs **~100 MB** of real
   disk (216,395 files x 0.46 KB), and an offline `pnpm install` against a warm store moved the
   free-space counter by 1,304 KB while `du` grew 82,460 KB. Read real usage from `df` before and
   after, never from `du`.
2. `git submodule update --init` for the `private` handbook submodule.
3. Copy the git-ignored config, which git does not carry into a worktree:
   `.env`, `.env.forge`, `.env.forge.local`, `.env.mixpanel`, `.env.sentry-build-plugin`,
   `tests/e2e-tests/.env`, `wrangler.toml`, `.claude/settings.local.json`.

Worktrees accumulate under this scheme — 37 existed on 2026-08-31, including one untouched for 8
days. Run the `worktree-cleanup` skill periodically; it removes the ones whose PR is merged.

## When you do NOT need a worktree (or a branch)

A worktree is only ever needed to keep two *working trees* from colliding. Don't reach for one reflexively:

- **`.md`-only changes and `.claude/skills/**`-only changes** go straight to `main` (per the exceptions above) — no feature branch. If your current tree is clean, just `git checkout main && git pull`, commit, push. With the primary checkout pinned to `main` this is the common path. Spin up a worktree only if that tree holds **another session's** uncommitted changes (see below) that block a clean `git checkout main`.
- **Git-ignored files only** (e.g. copied `.env`/auth-state, local `node_modules`, scratch screenshots): there is nothing to commit at all — no branch, no worktree, no PR.

In short: create a worktree when you need an isolated *checkout* — to avoid disrupting another session's dirty tree, or to run two branches at once. Not for trivial docs or untracked local files.

## Starting work on an issue

Check the current branch state first:

**If on `main`** (the normal state of the primary checkout) — create a worktree, leaving the primary
directory on `main`:
```bash
git worktree add ../conf-app-<feature> -b <feature-branch-name> main
```

**If on a different feature branch** (a worktree, or a primary checkout that drifted off `main`):
1. Check if the branch is clean: `git status`
2. **If clean** — return this checkout to `main`, pull, then branch the new work into its own
   worktree:
   ```bash
   git checkout main && git pull && git worktree add ../conf-app-<feature> -b <feature-branch-name> main
   ```
3. **If dirty (uncommitted changes)** — stop and present these options:
   1. Commit the current changes first, then create the worktree for the new work
   2. Leave this tree untouched and create the worktree straight from `main`: `git worktree add ../conf-app-<feature> -b <feature-branch-name> main`

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
