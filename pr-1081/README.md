# PR 1081: release draft order evidence

- Baseline: b0565325a30c2122a861e9a88479cdc2285fcb7f
- Candidate: dcd9c8f0b0e0715aae24283f13d85e19769762b6
- Environment: macOS, bash 3.2.57, gh against ZenUml/conf-app. Read-only; no release was published.

## Files

- `live-before-after.txt`: baseline and candidate scripts on real data. Section A uses the release list captured while the bug was live, with the compare API called live. Section B uses the current list. Section C is check-prerequisite.sh against live GitHub. New drafts landed during the work, which is why A and B differ.
- `tests-before.txt`: the new tests against the baseline scripts.
- `tests-after.txt`: the same tests against the candidate scripts.

## created_at measurement

Across 2,177 releases, comparing `created_at` with the target commit's committer date: pinned published releases matched 298 of 298; pinned drafts matched 0 of 1,252. 627 unpinned legacy releases were not compared.

## Limitations

A draft's created_at from before publish cannot be read back after publish, so the before/after change on a single release comes from the original report. The measurement above is the supporting evidence for it.
