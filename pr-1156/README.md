# PR 1156 decision event and Draft guard evidence

Baseline: `ed6b9f40bda3c50468b1c05410addfce029005e0`. Candidate: `d79c3f4637a5203834f0aaf98023a0fcceb34b2f`.

Observed baseline failure: [GitHub run 43386170037](https://github.com/ZenUml/conf-app/actions/runs/43386170037) attempted convertPullRequestToDraft with contents-read/pull-requests-write and received Resource not accessible by integration. Pending metadata events were also observed cancelled/replaced before processing; a deleted/edited decision webhook must not be discarded.

Candidate runs metadata synchronization with deferred Draft conversion, publishes its blocking check, then signals a separate trusted-main job. Only that job receives contents-write plus pull-requests-write, never persists checkout credentials, and rechecks current identity and decision before mutation. Per-PR queue:max retains pending events.

Raw local Node policy/CI results: 365 passed. Independent review found no P1/P2. Tests cover check publication before conversion failure, publication failure, fresh approvals, already-Draft state, identity changes, job permissions and retained queue.

Actual built-in GITHUB_TOKEN Ready-to-Draft conversion PASSED after merge: PR #994 was deliberately marked Ready at 08:35:11 UTC and github-actions[bot] converted it to Draft at 08:35:49 UTC. [Run 43394377249](https://github.com/ZenUml/conf-app/actions/runs/43394377249) succeeded. See live-draft-conversion.json. Live target normalization also resolved the stale PR API snapshot to actual main 46480f30; see live-base-normalization.json. No Confluence product code changes; UI validation N/A.

`observed-base-snapshot.json` records an actual old PR API base SHA differing from its target branch ref. The controller now resolves that ref for every identity read. Regression cases reject an old approval/merge against a moved target, accept a fresh record/refreshed merge, and fail closed on unavailable or non-commit refs. This observation establishes stale metadata; it does not claim a real clean stale merge was accepted.

Post-merge [main CI 43394134378](https://github.com/ZenUml/conf-app/actions/runs/43394134378): SUCCESS. All four staging variants validated and all four draft releases created. See draft-releases.json. No production release was performed.
