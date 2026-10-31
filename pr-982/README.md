# PR #982 — review evidence (Confluence 429: save retry + shared rate-limit cooldown)

- **BEFORE (baseline):** `b38b5acb` — merge-base of the PR with `main`.
- **AFTER (candidate):** `ad8a7464` — PR head at capture time.
- **Environment:** Vitest 2.1.9, jsdom, Node from the repo's `pnpm install --frozen-lockfile`; agent container, Linux. All Confluence / Forge calls are mocked (`@forge/bridge`), so no live site was touched.

This is a behavioural change with no new UI, so the evidence is the same regression specs run against both versions.

## A. True baseline vs candidate — `A-before.log` / `A-after.log`

The candidate's `src/model/ApWrapper2.spec.ts` and `functions/architecture-tokens/service.spec.ts` copied onto the baseline (no other change), then run:

```
npx vitest --run src/model/ApWrapper2.spec.ts functions/architecture-tokens/service.spec.ts
```

| | Result |
|---|---|
| BEFORE | 11 failed / 148 passed (159) |
| AFTER | 159 passed |

Behavioural failures on the baseline:
- `sends every save request with user priority, and no copy-scan ADF read` — the save's requests carry no retry priority, and the existence check runs an extra full-page ADF read.
- `throws when existence check returns other_error` — `save_existence_check_failed` has no `http_status`.
- `relatedDiagrams > carries the Confluence status of a failed lookup, so a 429 is told apart from a 5xx` — the backend drops Confluence's status.
- `updateCustomContentV2 …` (3) — the PUT and the conflict re-GET carry no `{ priority: 'user' }`.

The remaining failures (`getCustomContentByIdV2`, `probeOrphanRecovery`, `diagnoseCreateNotFound`, `create 404 diagnosis`) assert the new call signature (a trailing options argument), not behaviour.

## B. Wiring vs the throttle module alone — `B-before.log` / `B-after.log`

These specs import the new `src/utils/confluenceThrottle.ts`, so on the plain baseline they would only fail at import. To isolate what this PR *wires in*, the baseline gets the candidate's `confluenceThrottle.ts` and the candidate specs, and nothing else:

```
npx vitest --run src/utils/requestUtil.spec.ts src/model/SnapshotAttachment.spec.ts \
  src/components/Viewer/RelatedDiagramsFooter.spec.ts src/components/Viewer/DiagramAttributionFooter.spec.ts
```

| | Result |
|---|---|
| BEFORE (baseline + module only) | 8 failed / 111 passed (119) |
| AFTER | 119 passed |

The 8 baseline failures are exactly the wiring:
- `forgeRequest`: a save-path POST does not retry a 429; a background request is still sent during a cooldown.
- Snapshot backfill, attribution names, impact summary and related-diagrams lookup do not stand down during a cooldown.
- `related_diagrams_lookup_failed` lacks `http_status` / `confluence_http_status`, and a backend-reported 429 does not open the cooldown.

## C. Candidate only — `C-after-attachment-throttle.log`

`src/model/Attachment.spec.ts` + `src/utils/confluenceThrottle.spec.ts` on the candidate: 99 passed.

`Attachment.spec.ts` is **not** compared against the baseline. The baseline still has #961's separate cooldown module, which the candidate spec no longer resets between tests, so a cooldown leaks across the file and most of its tests fail for reasons unrelated to behaviour. The new PNG export-state test in that file ("a 429 on the upload stands the viewer's PNG export-state write down") was checked during development to fail when the export-state requests bypass the throttle.

## Limits

- No UI evidence: the change only shows while Confluence answers 429, and reproducing that on a tunnel or staging means exhausting a real site's rate limit.
- CI E2E on the candidate is reported in the PR (see the PR validation run for `ad8a7464`).
- Logs have local paths replaced with `<baseline-worktree>` / `<candidate-checkout>` / `<tmp>`.
