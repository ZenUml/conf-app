# PR 1240 evidence — clear the local draft when Publish commits

- BEFORE baseline: `main` 2bd7fae2. AFTER: PR head 34f450fd (CI candidate merge aaa600b0), Lite staging Forge 17.56.0.
- Browser: agent-browser (Chrome for Testing), robot test account on lite-stg, desktop viewport, no `--dismiss-paywall`.

| File | Step | Observed |
|---|---|---|
| hand-2.png | new Sequence macro open, auto-titled, before Publish | draft keys: `new:diagram` (positive control) |
| hand-3-after-publish.png | after Publish, macro rendered on the page | draft keys: `[]` |
| hand-4-second.png | second new macro on a fresh page | no "Unsaved changes" banner |
| hand-5-viewer-sees-draft.png | edit, type, close with X; read from the rendered viewer iframe | viewer iframe (same host as editor) reads `edit:<id>` draft, so a viewer read of `[]` is not vacuous |

Limits: a hand-driven browser usually cleared the draft on `main` too, so these screenshots do not distinguish BEFORE from AFTER. The distinguishing evidence is the unit tests (fail on `main`, pass on the PR) and CI E2E `sequence-edit:6`.
