# Pipeline graphs

PR validation and main preparation have separate entry workflows.

The main graph has five jobs: Source and version, Build preparation, Staging validation, Draft preparation, and Pipeline outcome. Build preparation and Staging validation run in parallel. Each phase job links to its independent child graph and waits for the result.

The build phase contains unit tests, preview tests, production bundles, and the cron deployment. The staging phase contains deployment, login preparation, and validation for each variant. Each variant validation links to its own E2E graph, which contains plans, shards, evidence, and reports. The draft phase verifies the exact build and staging producers and creates drafts only for variants whose original validation gates passed. A failed variant still fails the root run; other eligible drafts remain available.

Every checkout uses the root source SHA. Producing run IDs and attempts are explicit. E2E children verify both their phase dispatcher and the active root owner. Only the root acquires the shared staging concurrency group. Dispatcher jobs respond to cancellation; their `always()` cleanup steps stop their own remaining children before ending.

PR selection retains smoke and Jev-selected categories, with full coverage fallback. The human `test:all` override uses the PR entry. Main applies shared staging D1 migrations once, then deploys all four variants independently. Each validator waits only for its own deploy and authentication plus the parent ownership check. Daily full regression also runs all four variant transactions independently after its shared migration gate. Full has one validator; Lite results do not gate it. Drafts retain successful build, migration, per-variant validation, and daily regression gates.

```mermaid
flowchart LR
  Root[Main source and version] --> M[Shared staging migrations]
  Root --> AL[Auth Lite]
  Root --> AF[Auth Full]
  Root --> AD[Auth Diagramly]
  Root --> AA[Auth AsyncAPI]
  M --> L[Deploy Lite]
  M --> F[Deploy Full]
  M --> D[Deploy Diagramly]
  M --> A[Deploy AsyncAPI]
  L --> VL[Validate Lite]
  F --> VF[Validate Full]
  D --> VD[Validate Diagramly]
  A --> VA[Validate AsyncAPI]
  AL --> VL
  AF --> VF
  AD --> VD
  AA --> VA
  VL --> P[Record per-variant provenance]
  VF --> P
  VD --> P
  VA --> P
```

Production release order remains Diagramly → Lite → Full at least seven days after Lite; AsyncAPI is independent.

Automatic recovery listens only to root workflows. It checks the failures inside the exact phase before deciding whether they are E2E failures. Build, deploy, and draft failures prevent automatic retry. An eligible E2E failure triggers one complete root rerun, creating fresh attempt-specific producers.

The draft phase needs one more rule, because it goes red when a variant's E2E fails. That variant's draft is skipped, and the draft child's `Draft gate outcome` fails on every draft job that is not green, skipped ones included. Recovery (`scripts/ci/phase-recovery.mjs`) reads the draft child and ignores those skips and the gate failure when each skipped draft's variant has a failed `Validate: <Variant>` job, or a failed `E2E auth: <Variant>` bootstrap, in the same root. These still block a rerun: a draft job that failed, failed root ownership or draft eligibility, a cancelled job, a draft skipped although its variant validated (a closed daily regression gate, or a failed build or migration), and a draft child that cannot be found or is not a completed first attempt. Example: main run 38745939051, attempt 1 had `Validate: Full` and `Validate: Diagramly` red, `Draft: Full` and `Draft: Diagramly` skipped, and Run recovery 38747684585 declined to rerun it because it counted `Draft preparation` as a draft failure. A rerun also cuts new drafts under a new version, so drafts that attempt 1 already created for the passing variants stay behind as unused drafts.

Rerun a `main` root whole, never with `gh run rerun --failed`. `Source and version` uploads `main-root-options-<attempt>`, and `Verify root ownership` in each phase child downloads the artifact for its own root attempt. A failed-jobs-only rerun does not execute `Source and version` again, so the new attempt has no such artifact and every phase that the rerun starts stops at `Verify root ownership` with `no artifact matches any of the names or patterns provided`. This happened on run 38745939051: the `--failed` rerun was attempt 2 and failed in child run 38748851591; a plain `gh run rerun 38745939051` was attempt 3 and passed. Recovery itself always uses the plain form. The attempt-scoped artifact is deliberate (it binds the options to the exact root source and attempt), so this is a rule for humans, not a defect to redesign.

## View the new graph

Start a new run from the revision containing these workflows. An old run retains its original workflow definition when rerun. Open a phase job summary for the child graph; open a variant validation summary for its test shards.

The phase workflows and root can land together: the root starts only on main, where all dispatched workflow files exist after the merge.
