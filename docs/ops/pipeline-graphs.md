# Pipeline graphs

PR validation and main draft preparation have separate entry workflows. PR validation contains build, preview, selection, Lite deploy, validation, and outcome jobs. Main keeps the four variant deployment and draft gates.

The validation jobs dispatch independent E2E runs and wait for their result. Each validation job summary links to its child run. Shards, concrete test plans, evidence, and merged reports appear in that child graph. A failed child fails its parent validation job.

Children check that their parent run is active and in the matching attempt. Test checkout uses the source SHA supplied by the parent. Selection and authentication artifacts come from the parent run. The parent holds the shared staging concurrency group while the child executes; children do not acquire the same lock. Each dispatcher has an always-running cleanup step that cancels its own remaining child and checks that it has stopped.

The `test:all` label dispatches the PR entry with full coverage. Normal PR selection retains smoke and Jev-selected categories, with full coverage fallback. Main retains its existing normal suites and Full-after-Lite gate.

## Enable the new graph

1. Merge the child workflow files, shared E2E artifact inputs, and dispatch helper first. GitHub requires dispatched workflows to exist on the default branch.
2. Merge the separate PR entry and main dispatcher changes.
3. Start a new run from that revision. An old run retains its original workflow graph when rerun.
4. Check the parent graph. Open the validation job summary to find the shard graph.

The parent graph remains a real job graph. Deployment, build, and draft jobs remain visible. E2E shards belong to separate runs.
