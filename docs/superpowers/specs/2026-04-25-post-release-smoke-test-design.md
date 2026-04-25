# Post-Release Smoke Test in `release.yml`

**Date**: 2026-04-25
**Status**: Approved

## Problem

`.github/workflows/release.yml` deploys one variant (lite/full/diagramly) per release tag to Cloudflare Pages and Forge production. Today, there is no automated verification that the deploy actually works in prod — the scheduled `smoke-test.yml` runs only on a 02:00 UTC cron, so a broken release can sit unnoticed for hours.

We want a fast feedback signal: as soon as a release deploy completes, run a prod smoke test against the variant that was just shipped. Rollback is **out of scope** for this change.

## Goals

- Run a prod smoke test immediately after a successful release deploy.
- Cover only the variant that was just released (not all three).
- Reuse the existing `e2e-test.yml` reusable workflow that `smoke-test.yml` already uses.
- Surface failure on the release run so it's visible without hunting.

## Non-Goals

- No rollback automation (handled later).
- No manual approval gates / environments.
- No changes to `smoke-test.yml` (keeps its scheduled role).
- No new variants or test suites.

## Design

### New `smoke-test` job in `release.yml`

```yaml
smoke-test:
  needs: release
  name: Smoke Test (Prod) — ${{ needs.release.outputs.license }}
  uses: ./.github/workflows/e2e-test.yml
  with:
    app: ${{ needs.release.outputs.license == 'lite' && 'zenuml-lite@prod'
          || needs.release.outputs.license == 'full' && 'zenuml-full@prod'
          || 'diagramly@prod' }}
    suite: insert
    artifact-suffix: ${{ needs.release.outputs.license }}-prod
  secrets:
    username: ${{ vars.ZENUML_PROD_USERNAME }}
    password: ${{ vars.ZENUML_PROD_PASSWORD }}
    otp: ${{ vars.ATLASSIAN_OTP }}
```

### `release` job changes

Promote `steps.properties.outputs.license` to a job-level output so the new job can read it:

```yaml
release:
  ...
  outputs:
    license: ${{ steps.properties.outputs.license }}
  steps:
    ...
```

No other changes to the `release` job's steps.

### Variant → app mapping

| `license` | reusable workflow `app` input |
|-----------|-------------------------------|
| `lite`    | `zenuml-lite@prod`            |
| `full`    | `zenuml-full@prod`            |
| `diagramly` | `diagramly@prod`            |

This matches what `smoke-test.yml` already does for the scheduled prod run.

### Failure behavior

- If `smoke-test` fails, the `Release` workflow run shows red. The release itself (Forge + Cloudflare deploy) has already happened — smoke is a **verification** signal, not a gate.
- The operator decides what to do (rollback flow not yet automated; re-running a prior release tag's workflow is the manual path for now).

## Affected files

- `.github/workflows/release.yml` — add `outputs` to `release`, add new `smoke-test` job

## Out of scope (explicitly)

- `.github/workflows/smoke-test.yml` — unchanged
- `deploy-cron-worker` job — unchanged
- Rollback (Forge/Cloudflare) — separate future spec
- Manual approval gates / GitHub Environments — separate future spec
