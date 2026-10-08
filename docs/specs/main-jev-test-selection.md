# Main test selection and daily regression gate

Status: implementation candidate. User-confirmed design, 2026-10-08.

## Required behavior

- Preserve the five-stage main pipeline graph and existing staging deployment order. Production deployment configuration is out of scope.
- Compare the candidate main SHA with the latest prior successful main validation SHA that is its ancestor. Include every intervening change, including changes from failed or cancelled runs. If no verified baseline or complete diff exists, run full regression.
- Deploy all four variants. For each variant run applicable smoke tests, directly modified E2E specs/helper dependencies, and exact behavior categories selected by Jev from the complete regression inventory, including edit and syntax projects. Descriptive broad tags never select tests.
- Shared and unmapped application files go to Jev. CI, selector, and category catalog changes require full regression. Unrecognized E2E helpers require full coverage until their dependent specs are proven. Sensitive or incomplete diffs are never sent to Jev and require full regression.
- A valid Jev result with all category probabilities below 0.1 explicitly means no additional impact: smoke/direct tests only. An ambiguous empty result, malformed result, timeout, missing credentials or invalid selection artifact requires full regression. Jev still uses the existing 0.8 category selection threshold.
- Daily full staging regression covers Lite, Full, Diagramly and AsyncAPI. The latest completed main regression must succeed, target an ancestor of the candidate, and be no older than 36 hours. Missing, failed, cancelled, invalid or stale evidence blocks all new release drafts. Build and validation continue.
- A manual main run may bypass only this daily regression gate, for one run, with a required nonempty reason. It never bypasses this run's tests or build gates. Verify options against immutable root run/attempt/SHA provenance; direct child dispatch cannot grant bypass.
- The Run workflow form exposes force-full and bypass options separately, with explanatory labels. Blocked run summaries show the reason and exact steps to refresh regression or bypass once. Run summaries and draft descriptions retain the bypass reason.
- A manual force-full option runs complete regression independently of the daily gate option.

## Results and evidence

Root options are recorded once per root attempt. Main selection is produced by the verified staging phase and downloaded by its E2E children. Every variant records its concrete selected plan and execution evidence. An authorized empty render plan has zero shards; it does not silently widen to full render coverage.

No change to production release order: Diagramly, Lite at the same commit, Full after the established soak; AsyncAPI independent.

## Adjacent work

PR #751 separates shared backend deployment from Forge variant deployment. It changes some of the same staging workflow files, but does not implement Jev selection on main or the daily regression gate. Reconcile those files before merging both changes.
