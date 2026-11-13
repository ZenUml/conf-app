# Auto lane: what automation may change without a human

The auto lane is the set of changes an agent may open, and for some classes merge, with no human
in the loop. It exists for work that never reaches the team's priority bar: stale dependency
patches, small documentation fixes, long-standing low-volume errors.

**Status (2026-11-13): policy, classifier and one automation, switched off.** The only automation is
`.github/workflows/auto-lane-merge.yml`: once a day it merges at most one open Dependabot PR that the
classifier calls `auto-merge` and whose checks are all green. It does nothing until the repository variable
`AUTO_LANE_ENABLED` is `true`. No workflow opens PRs yet. Production releases are always started by a
person; the auto lane never releases.

## The rule

A diff gets the autonomy level that `scripts/ci/auto-lane-policy.mjs` prints for it, and nothing
higher. The classifier reads the diff only. It does not read the PR title, the description, a
label, or a model's opinion of the risk, so none of those can raise the level.

```bash
node scripts/ci/auto-lane-policy.mjs --base origin/main --head HEAD            # level, lane, reasons
node scripts/ci/auto-lane-policy.mjs --base origin/main --head HEAD --require auto-merge   # exit 1 if lower
```

| Level | Meaning |
|---|---|
| `auto-merge` | Automation may merge to `main` after every check on the head commit is green. |
| `auto-pr` | Automation may open the PR. The daily job does not merge it. |
| `report-only` | Automation may file an issue with evidence. It opens no PR. |

`main` has no required checks and no required review (ruleset `main`: deletion and
non-fast-forward only, read 2026-11-13). GitHub will not stop a bad merge, so the merging job must
run `--require auto-merge` itself, on the exact head SHA it merges, and must confirm the checks
for that SHA.

## Lanes by example

Rules run top to bottom; the first match decides. The test file
`scripts/ci/auto-lane-policy.node-test.mjs` holds one test per row and is the full specification.

| Change | Lane | Level |
|---|---|---|
| `pnpm-lock.yaml` only, `minimatch` 3.1.2 → 3.1.4 | `lock-transitive` | auto-merge |
| `devDependencies` `vitest` ^3.2.4 → ^3.2.6, with lockfile | `deps-dev-minor` | auto-merge |
| `README.md`, 4 lines | `docs-only` | auto-merge |
| `docs/a.md`, 60 lines | `docs-large` | auto-pr |
| `dependencies` `axios` ^1.15.0 → ^1.16.0 | `deps-prod-minor` | auto-pr |
| 11 dev packages in one PR | `deps-dev-bulk` | auto-pr |
| Lockfile adds a package name that was not there before | `lock-new-package` | auto-pr |
| Test files only | `tests-only` | auto-pr |
| ≤ 3 files under `src/`, `functions/`, `scripts/`; ≤ 40 lines; a test added | `small-fix` | auto-pr |
| `vitest` ^2.1.9 → ^4.1.6, or `foo` ^0.3.1 → ^0.4.0 | `deps-major` | report-only |
| A new or removed dependency; a `scripts`, `resolutions` or `overrides` edit | `deps-add-remove`, `deps-manifest-other` | report-only |
| Test files only, more lines deleted than added | `tests-shrink` | report-only |
| `src/a.ts` with no test, or more than 40 lines | `unclassified` | report-only |
| Any denied path (below), even beside an allowed file | `denied-path` | report-only |

### Denied paths

A diff that touches one of these is `report-only`, whatever else is in it:

- Platform and consent: `manifest.yml`, `wrangler*.toml`, migrations, `public/_routes.json`,
  `scripts/forge-wizard.mjs`. A scope or remote change is a major Forge version.
- Money and identity: any path matching `paywall`, `licence`/`license`, `billing`, `oauth`, `auth`;
  `functions/_middleware.ts`.
- The lane's own controls: `.github/**`, `scripts/ci/auto-lane-*`, `docs/policies/**`, `CLAUDE.md`,
  `.claude/**`, `.cursor/**`. Automation cannot edit its guard or its instructions.
- Supply chain: `.npmrc`, `pnpm-workspace.yaml`, `patches/**`, `vendor/**`, `private`.

The `auth` pattern is broad on purpose and also matches words such as `author`. A false refusal
costs one human review; a false approval is the failure this policy exists to prevent.

## Backtest (2026-11-13, classifier at `5b46a60e`)

Every PR merged from 2026-09-13 to 2026-11-12 (222), classified from its merge commit:

| Level | PRs | Main lanes |
|---|---|---|
| report-only | 181 | `denied-path` 106, `unclassified` 74 |
| auto-pr | 40 | `small-fix` 31, `tests-only` 6 |
| auto-merge | 1 | `docs-only` (#984, 6 lines) |

None of the three revert commits in that window's history that were checked classifies above
`report-only`. Human work is almost never auto-merge material, which is the intended result: the
lane is for changes people do not get to.

The six Dependabot PRs open on that day:

| PR | Change | Verdict |
|---|---|---|
| #98, #101 | dev major (`concurrently` 8→9, `vitest` 2→4) | report-only `deps-major` |
| #99 | prod major (`@fastify/static` 8→9) | report-only `deps-major` |
| #100 | dev minor (`tailwindcss` ^4.2.4 → ^4.3.0), checks green | auto-merge `deps-dev-minor` |
| #315 | 39 packages plus a `resolutions` edit, checks red | report-only `deps-manifest-other` |
| #328 | prod and dev mixed in one group, checks red | auto-pr `deps-prod-minor` |

By policy one of six qualifies (#100). The merge job still skips it: its green checks date from
2026-10-28, older than the 7-day limit. The two grouped PRs could not qualify because
`.github/dependabot.yml` grouped production and development packages together; the groups are now
split by `dependency-type`, so a development-only PR can.

## Controls

| Control | State | How it works |
|---|---|---|
| Kill switch | Built, OFF | Repository variable `AUTO_LANE_ENABLED`. Anything but the exact string `true` makes the job print `auto lane disabled` and stop before any network call. |
| Volume cap | Built | Two merges per UTC day (counted from merged PRs that carry the `auto-lane` label) and one merge per run. Reason: `PR validation` holds the shared staging lock, median 18 min, longest 60 min over 38 runs. |
| Ledger | Built for merges | The job adds the label `auto-lane` to a PR just before it merges it. The daily cap reads that label. |
| Hold | Built | A person adds the label `auto-lane:hold` to a PR; the job skips it. |
| Release age | Built | `cooldown: default-days: 7` on all three npm entries in `.github/dependabot.yml`. A freshly published version is the supply-chain risk. Cooldown does not delay security updates. |
| Group split | Built | Each npm entry has two groups, `npm-dev-minor-and-patch` and `npm-prod-minor-and-patch`, so a development-only PR can reach `deps-dev-minor`. |
| Promotion | Not built | A lane moves from auto-pr to auto-merge after 10 merges with no revert. Today the levels are fixed in the classifier. |
| Error signatures | Not built | Standing signatures become `report-only` issues, without tenant names (this repository is public). |
| Other authors | Not built | The job merges only PRs by `app/dependabot`, the login `gh` prints for Dependabot. Agent and human PRs are never merged by it. |

## Agent sessions

Owner's rule, 2026-11-13: "AI对于低风险的PR可以自行合并，毋须确认。" Amended the same day: "把低风险改成
非破坏性，比如CICD的只要不是直接部署都是属于非破坏性。" An agent session may merge a non-destructive PR
to `main` without asking. This replaces the 2026-10-22 rule that every merge was the owner's.

The classifier levels above bind the daily job only. A session does not need `auto-merge` or
`auto-pr`: a CI change under `.github/**` is `report-only` for the job and still non-destructive
for a session, unless it deploys.

Working list of what is destructive (the session's reading; only the CI example is the owner's):

| The PR, once merged, ... | Example | Agent session |
|---|---|---|
| changes CI/CD without deploying anything itself | test selection, a new check, a cron job that only reads | Merges without asking. |
| changes code, tests or docs, with every check green | a bug fix with its test | Merges without asking. |
| deploys or releases directly | a workflow step that publishes a production release, or deploys on merge with no human trigger | Offers `[AI] Merge PR #N`; merges when the owner picks it. |
| deletes or rewrites stored data | a D1 migration that drops or rewrites a column, a script that purges KV keys | Offers the option; does not merge on its own. |
| cannot be undone by a revert | a Forge manifest change that forces a major version (scopes, remotes), a deleted feature flag | Offers the option; does not merge on its own. |

The rule covers a PR by any author: the session's own, another session's or a person's (owner's
pick, 2026-11-13). Preconditions for any session merge: not a draft, base `main`, no requested changes, `MERGEABLE`,
every check on the head commit green, head unchanged since the checks. Run
`.claude/skills/auto-lane/scripts/classify-pr.sh <PR>`: it checks those and lists files on paths
that need the destructive reading (`migrations/`, `manifest.yml`, release and deploy workflows).
Merge with a merge commit and `--match-head-commit`, then watch `main` CI. The normal staging
deploy that every merge to `main` starts is not "deploying directly". A production release still
needs the owner's explicit trigger.

### What the merge job checks

It skips a PR, with the reason printed, unless all of these hold, tested in this order:
the switch is `true`; fewer than 2 merged today; not a draft; author is `app/dependabot` and a bot; head
repository is this repository; base is `main`; no `auto-lane:hold` label; GitHub reports `MERGEABLE`; the
classifier, run from `main` on `merge-base..head`, says `auto-merge`; there is at least one check run on the
head SHA; none is unfinished; none failed (a cancelled run is ignored when a later run of the same name
succeeded); `Build and Unit Test`, `E2E validation` and `Pipeline outcome` all succeeded; and each of those three finished
within the last 7 days (an older green run was not tested against today's `main`; a rebase of the PR renews it).
The merge uses `--match-head-commit`, so a push after the check cannot slip in, and makes a merge commit,
not a squash. A merge made with `GITHUB_TOKEN` starts no `push` workflow, so the job then dispatches
`build-test-deploy.yml` on `main`; a dispatch with default inputs runs the same pipeline a push does.

## Turning it on / off

```bash
gh variable set AUTO_LANE_ENABLED --body true     # on: the daily run may merge
gh variable set AUTO_LANE_ENABLED --body false    # off: every run is a no-op

gh workflow run auto-lane-merge.yml               # dry run: prints decisions, writes nothing
gh workflow run auto-lane-merge.yml -f dry-run=false   # real run; still a dry run unless the variable is true
node scripts/ci/auto-lane-merge.mjs --dry-run     # the same dry run from a checkout of main, with gh logged in
```

A scheduled run is never a dry run. To stop one PR, add the label `auto-lane:hold`.

## Known gaps in the classifier

- File mode and symlink changes do not appear in `git diff --numstat`.
- A lockfile `integrity` change at an unchanged `name@version` is not detected.
- `yarn.lock` and `bun.lockb` are not parsed; a change to one is `lock-unparsed`, auto-pr.
