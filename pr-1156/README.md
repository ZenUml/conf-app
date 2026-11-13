# PR 1156 decision event and Draft guard evidence

Baseline: `ed6b9f40bda3c50468b1c05410addfce029005e0`. Candidate: `4fe082e65eac1f8813c64ee7f0d0a577d33344aa`.

Observed baseline failure: [GitHub run 43386170037](https://github.com/ZenUml/conf-app/actions/runs/43386170037) attempted convertPullRequestToDraft with contents-read/pull-requests-write and received Resource not accessible by integration. Pending metadata events were also observed cancelled/replaced before processing; a deleted/edited decision webhook must not be discarded.

Candidate runs metadata synchronization with deferred Draft conversion, publishes its blocking check, then signals a separate trusted-main job. Only that job receives contents-write plus pull-requests-write, never persists checkout credentials, and rechecks current identity and decision before mutation. Per-PR queue:max retains pending events.

Raw local Node policy/CI results: 360 passed. Independent review found no P1/P2. Tests cover check publication before conversion failure, publication failure, fresh approvals, already-Draft state, identity changes, job permissions and retained queue.

Actual built-in GITHUB_TOKEN Ready-to-Draft conversion remains pending at capture: the new workflow must exist on main first. GitHub current-head results and post-merge acceptance will be linked in the PR body. No Confluence product code changes; UI validation N/A.
