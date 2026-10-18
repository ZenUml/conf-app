# 0009 — Main promotes PR-validated artifacts, and the staging gate moves to release

Date: 2026-10-19
Status: proposed — the owner decides; nothing in this record is implemented
Related: [ADR-0006](0006-release-pipeline-optimised-for-wall-clock.md), [ADR-0007](0007-release-order-aware-pipeline.md), [docs/ops/pipeline-graphs.md](../ops/pipeline-graphs.md), [docs/ops/release-pipeline-time-budget.md](../ops/release-pipeline-time-budget.md), `.github/workflows/build-test-deploy.yml`, `.github/workflows/main-draft-preparation.yml`, `.github/workflows/release.yml`, `scripts/test-selection/reuse.mjs`, `.claude/skills/release-app/SKILL.md`, PR #818 (sensitive-diff regex), PR #819 (baseline pagination)

The repository owner asked on 2026-10-18 for the main pipeline to finish in one
minute, to shorten the wait between a merge and release work. A measurement run
that day asked how fast a draft can follow a merge. Under the current contract
the floor is about 7.5 minutes (estimate, section 2). This record answers what
one minute would take, and asks whether the contract itself should change. It
does not decide.

## The three clocks

| clock | from → to | this ADR |
|---|---|---|
| PR verdict | push → green PR run | unchanged under A and C; under B it builds all four production bundles (see B) |
| merge → draft | merge commit → draft release exists | **changes** |
| merge → release-ready | merge commit → staging deployed and E2E green on this commit | unchanged in length, moves behind the draft |

merge → draft, today and per option (seconds; every option figure is an estimate):

| | today (p50, section 2) | A | C | B |
|---|---|---|---|---|
| last draft | about 653 selected / about 1666 full | about 578 | about 653 (unchanged) | about 120 |
| Lite draft | same as last draft | about 578 (A's trims only) | about 585 (C alone); about 510 under A+C, C's 585 minus A's 75 | about 120 |

Since ADR-0007's superseding decision (2026-10-09), merge → draft equals the whole
main run: `draft-preparation` needs `[version, build-preparation, staging-validation]`
(`build-test-deploy.yml:143`). In September the Lite draft came earlier, per
variant: 3m36s (run 34667481219) to 3m42s (run 34662255935 attempt 2), both
measured from the first job. Run 34660754910 shows 4m42s, measured from push.
All were reuse hits (`docs/ops/release-pipeline-time-budget.md`).

## The floor under the current contract

Data: 14 selected-mode main runs, 2026-10-11 → 10-18 (`t2-measurement.md`,
`critical-path-report.md`, in the author's unattended-run evidence folder; they are
not in the repository). The public subset is in
`docs/ops/release-pipeline-time-budget.md`, section "Main runs 2026-10-11 → 10-18:
two modes" (PR #818). Selected mode: exec p50 653 s, p90 692 s
(`critical-path-report.md` §1). Full-regression mode: exec p50 1666 s (see the
runner-cap section).

Quiet selected run 39082321939, exec 649 s:

| node | measured | class |
|---|---|---|
| Deploy: Lite (job 117541966902) | Cloudflare 76 s in parallel with Forge 75 s | irreducible while main deploys |
| one E2E shard | 69–108 s | irreducible while main tests |
| E2E plan + aggregate + dispatch | 26 + 14 + 8 s per variant | movable |
| Verify root ownership | 34 s | reducible, about 16 s: the history fetch (about 1 s) is needed and an owner check (about 11 s) remains; PR #819 takes the job from about 34 s to about 18 s (`t2-measurement.md` §D) |
| D1 migration gate | 35 s | movable |
| Draft preparation | 73–97 s (52 s work, 26 s dispatch, queue and poll) | movable |
| Source, Outcome, dispatch gaps | about 55 s | removable |

The orchestration tax (exec − tail deploy − tail validate) is 219 s at p50.
Deploy plus one shard is about 180 s serial. **Under "deploy to Forge staging and
run a browser test before cutting a draft", 60 s is unreachable.**

Estimate, from exec p50 653 s (selected mode):

- Option A as listed removes about 15 s (PR #819) + 35 s (migration gate) + 25 s
  (shard cap, p50) ≈ 75 s → about 578 s ≈ 9.6 min p50 for the last draft.
- Every movable or removable node together adds the E2E plan, aggregate and
  dispatch (48 s), Source, Outcome and dispatch gaps (about 55 s) and Draft
  preparation overhead (26 s): ≈ 204 s in total → about 449 s ≈ 7.5 min. This is
  the floor under the current contract (estimate).

## The runner cap is a cost of the architecture

`t2-measurement.md`: each selected run has 83 non-skipped jobs and reaches the
20-job runner cap in 13 of 14 runs (19 in the other). When at the cap, shards
hold 68% of the slots and polling waiters hold 26% (four `Validate` dispatchers
19%, root phase jobs 7%). Waiters do no work; they exist because the root
dispatches child workflows and polls them (`scripts/ci/wait-for-e2e.mjs`).

Full-regression mode (36 shards) queues the tail shard 627 s at p50 and queues
the next main run on the concurrency group: 11 of 30 runs waited more than 60 s,
6.1 h in total (`critical-path-report.md` §2). PR #818 should cut how often that
mode is entered (14 of 30 runs were `potential-sensitive-diff`); it does not
remove the waiters.

## Options

**A. Keep the contract; land the measured trims.** PR #819 (about −15 s);
move the migration gate behind the deploys (−35 s, `t2-measurement.md` trim 1;
trade-off: a failed migration no longer stops new code reaching shared staging);
cap selected shards at 4 (gain p50 25 s, p90 52 s, minimum −20 s, so some runs
get slower; replay model, `t2-measurement.md` "Replay detail"); restore
per-variant drafts so Lite is not held by the slowest variant. Last draft about
578 s ≈ 9.6 min (estimate, section 2). Per-variant drafts do not restore reuse
(0 hits in 54 runs, `critical-path-report.md` §5), so September's 3m36s–3m42s
Lite draft does not return. Current-graph estimate: in quiet run 39082321939
`Validate: Lite` ended about 510 s after the run start (child offsets 266 → 486 s,
`critical-path-report.md` §3; the child started 24 s after the root), so a Lite
draft lands at about 510 s + draft creation about 75 s ≈ 585 s ≈ 9.8 min. Risk:
low, all main-only YAML that a PR cannot exercise (ADR-0007). Does not touch the
waiters.

**B. Promote-only main.** The PR validates the tree that will be merged: either
a GitHub merge queue (that page says: "You must use the merge_group event to
trigger your GitHub Actions workflow when a pull request is added to a merge
queue."). Three GitHub Docs pages fetched on 2026-10-19 ("Managing a merge
queue", "About protected branches", "About merge methods on GitHub") carry no
availability statement by plan or repository type. The repository is public and
organisation-owned (`gh repo view`: PUBLIC, isInOrganization true) and has one
ruleset. Verify in one minute: open the branch protection or ruleset settings for
`main` and check whether "Require merge queue" is offered. The other path is the exact-tree evidence path that `reuse.mjs` implements and no
workflow calls. It needs complete PR coverage: today 18 of the last 30
merge commits have `tree(merge) == tree(PR head)` but PR selection leaves the
evidence partial, and the legacy reuse check hit 0 times in 54 main runs
(`critical-path-report.md` §5). Main then attaches the PR's `build-prod`
artifacts and cuts drafts in an estimated 2 minutes — not measured: today's Source
and dispatch hops (about 40 s) plus draft creation (73–97 s, which needs its own
trim). Staging deploy and E2E run after the draft and gate the
**release**, not the draft. Costs: PR runs build no production bundles today;
`build-prod` exists only in `main-build-preparation.yml` (line 228) and uploads
`dist-prod-*` with `retention-days: 3` (line 284). Under B every PR run must build
all four production bundles, and a PR merged more than three days after its last
run has expired artifacts and must rebuild or be re-run. Risks: a draft can exist for a commit whose staging
E2E later fails, so `release-app` (and `check-prerequisite.sh`) must read that
result; `release.yml` triggers on a published release and has no staging check
today; the provenance model (root run and attempt binding, the `{sha, variant}`
marker) moves with the gate; the daily-regression gate interplay needs a rule;
the merged tree must be proven byte-identical to the PR tree
(sha256 of `dist-prod-*.tgz`).

**C. Hybrid.** Per-variant drafts as each validation finishes (September
behaviour), gate unchanged. The last draft stays near 653 s; the Lite draft is
about 585 s ≈ 9.8 min (same estimate as A). Smallest change; it does not touch the
waiter cost.

## Recommendation

**A, with C's per-variant drafts, now; B only on an explicit need for merge →
draft near 2 minutes.** A+C leaves the last draft near 9.6 min and Lite near 8.5
min (estimates); B is the only option near 2 min (estimate), and it costs the
items listed under B. The measured gain of A+C is about one to two minutes, so the
owner may reasonably choose option **none**: do nothing beyond #818 and #819. B
moves a safety check from draft to
release, depends on a merge-queue availability fact nobody has verified, and
gives up a property the current graph keeps (pipeline-graphs.md: drafts are
created only for variants whose validation gates passed; ADR-0006: a draft is
never cut from a commit whose unit tests failed). Do not pay that price without a
person who needs sub-5-minute drafts. Status stays proposed.

## Verification plan (whichever option lands)

- `evidence/collect.py`-style exec p50/p90 by mode on the next 20 main runs, plus the group-wait sum.
- Draft `created_at` minus merge-commit time, per variant.
- sha256 of `dist-prod-*.tgz` identical before and after.
- Flake ranking (`e2e-flake-ranking.yml`) and shard pass counts unchanged.
- PVT green on the first release through the new path.
- For B: a deliberately red post-draft E2E must block `release-app`.

## Open questions for the owner

1. **Sensitive-diff definition (PR #818).** Accept the narrowed regex (a true match still falls to full regression), or fall to the deterministic floor instead, which is cheaper and weaker.
2. **Merge order against PR #779.** Both touch `classify.mjs`; either order works with a routine rebase.
3. **First main run after #818 merges.** PR #818's own diff replays as `selected` through `readDiff` (no sensitive match, floor `@smoke`, `POLICY_VERSION` unchanged), so no full run is expected from it; if that run is full anyway, read its `Selection saved:` line before judging the change.
4. **Migration gate and shard cap.** Migration gate behind the deploys (−35 s) weakens PR #751's guard; the 4-shard cap is model-based and needs a paired measurement.
5. **Option choice (this ADR).** A+C, B, or none.

## Decided next steps

None. Proposed only.
