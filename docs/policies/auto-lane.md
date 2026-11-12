# Auto lane: what automation may change without a human

The auto lane is the set of changes an agent may open, and for some classes merge, with no human
in the loop. It exists for work that never reaches the team's priority bar: stale dependency
patches, small documentation fixes, long-standing low-volume errors.

**Status (2026-11-13): policy and classifier only.** No workflow opens or merges anything yet.
Production releases are always started by a person; the auto lane never releases.

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
| `auto-pr` | Automation may open the PR. A person merges. |
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

One of six qualifies. The two grouped PRs cannot, because `.github/dependabot.yml` groups
production and development packages together. Splitting the group by `dependency-type` is the
change that would let the development half flow.

## Not built yet

| Control | Decision | Why |
|---|---|---|
| Kill switch | Repository variable `AUTO_LANE_ENABLED`; anything but `true` makes every job a no-op | One place to stop it |
| Volume cap | One open auto-lane PR at a time, two a day | `PR validation` holds the shared staging lock: median 18 min, longest 60 min over 38 runs |
| Ledger | Label `auto-lane` on every issue and PR the lane opens | Dedupe and audit without a database |
| Release age | Dependabot `cooldown` of 7 days for version updates | A freshly published version is the supply-chain risk; cooldown does not apply to security updates |
| Promotion | A lane moves from auto-pr to auto-merge after 10 merges with no revert | Autonomy is earned per lane |
| Error signatures | Standing signatures become `report-only` issues, without tenant names | This repository is public |

## Known gaps in the classifier

- File mode and symlink changes do not appear in `git diff --numstat`.
- A lockfile `integrity` change at an unchanged `name@version` is not detected.
- `yarn.lock` and `bun.lockb` are not parsed; a change to one is `lock-unparsed`, auto-pr.
