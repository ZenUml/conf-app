# Post-Release Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a prod smoke test against the just-released variant immediately after the `release` job completes in `.github/workflows/release.yml`.

**Architecture:** Promote `steps.properties.outputs.license` to a job-level output on the `release` job. Add a new `smoke-test` job that depends on `release`, calls the existing `./.github/workflows/e2e-test.yml` reusable workflow, and selects the prod app target based on the variant's license value.

**Tech Stack:** GitHub Actions YAML (reusable workflows via `uses:`, job outputs).

**Spec:** `docs/superpowers/specs/2026-04-25-post-release-smoke-test-design.md`

---

## File Structure

- **Modify:** `.github/workflows/release.yml`
  - Add `outputs.license` to the `release` job
  - Add a new top-level `smoke-test` job that consumes that output and calls `e2e-test.yml`

No other files change. `.github/workflows/e2e-test.yml` and `.github/workflows/smoke-test.yml` are untouched.

---

## Task 1: Expose `license` as a job output on `release`

**Files:**
- Modify: `.github/workflows/release.yml` (add `outputs:` block on the `release` job)

- [ ] **Step 1: Add `outputs` block to the `release` job**

Locate the `release:` job definition (currently starts at line 10). Insert an `outputs:` block immediately after the `env:` block, before `steps:`.

Current shape (around lines 10–18):
```yaml
  release:
    name: ${{ github.event.release.tag_name }} to production
    runs-on: ubuntu-latest
    env:
      FORGE_EMAIL: "${{ vars.FORGE_EMAIL }}"
      FORGE_API_TOKEN: "${{ secrets.FORGE_API_TOKEN }}"
    steps:
```

Change to:
```yaml
  release:
    name: ${{ github.event.release.tag_name }} to production
    runs-on: ubuntu-latest
    env:
      FORGE_EMAIL: "${{ vars.FORGE_EMAIL }}"
      FORGE_API_TOKEN: "${{ secrets.FORGE_API_TOKEN }}"
    outputs:
      license: ${{ steps.properties.outputs.license }}
    steps:
```

- [ ] **Step 2: Lint the YAML locally**

Run: `npx --yes @action-validator/cli@latest .github/workflows/release.yml`
Expected: no errors. If `@action-validator/cli` is unavailable, run `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` — expected: no output (valid YAML).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): expose license as job output"
```

---

## Task 2: Add `smoke-test` job that calls `e2e-test.yml` for the released variant

**Files:**
- Modify: `.github/workflows/release.yml` (append new top-level job)

- [ ] **Step 1: Append the `smoke-test` job after `deploy-cron-worker`**

The current file ends with the `deploy-cron-worker:` job. Append the following at the end of the file (top-level job, sibling of `release` and `deploy-cron-worker`):

```yaml
  smoke-test:
    needs: release
    name: Smoke Test (Prod) — ${{ needs.release.outputs.license }}
    uses: ./.github/workflows/e2e-test.yml
    with:
      app: ${{ needs.release.outputs.license == 'lite' && 'zenuml-lite@prod' || needs.release.outputs.license == 'full' && 'zenuml-full@prod' || 'diagramly@prod' }}
      suite: insert
      artifact-suffix: ${{ needs.release.outputs.license }}-prod
    secrets:
      username: ${{ vars.ZENUML_PROD_USERNAME }}
      password: ${{ vars.ZENUML_PROD_PASSWORD }}
      otp: ${{ vars.ATLASSIAN_OTP }}
```

Notes:
- Indentation is two spaces (matches existing jobs in this file).
- The `app` expression replicates the variant→target mapping used in `smoke-test.yml` for the scheduled prod run (`zenuml-lite@prod`, `zenuml-full@prod`, `diagramly@prod`).
- `secrets:` is passed through because `e2e-test.yml` declares them as inputs (same as `smoke-test.yml`'s prod jobs at lines 16–19, 29–32, 42–45).

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: no output (valid YAML).

- [ ] **Step 3: Verify the reusable workflow's input contract matches**

Run: `grep -nE 'app:|suite:|artifact-suffix:|username:|password:|otp:' .github/workflows/e2e-test.yml | head -40`
Expected: confirms `app`, `suite`, `artifact-suffix` are declared under `inputs:` and `username`, `password`, `otp` are declared under `secrets:` of the reusable workflow. If any name differs, update Task 2 Step 1 to match.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): smoke test prod after release job"
```

---

## Task 3: Push branch and open PR

- [ ] **Step 1: Push the branch**

Run: `git push -u origin ci/post-release-smoke-test`
Expected: branch published.

- [ ] **Step 2: Open PR**

Use the `submit-branch` skill or:
```bash
gh pr create --title "ci(release): smoke test prod after release job" --body "$(cat <<'EOF'
## Summary
- Expose `license` as a job-level output on the `release` job
- Add a `smoke-test` job that runs after `release`, calling the existing `e2e-test.yml` reusable workflow against the prod app for the released variant

## Test plan
- [ ] CI YAML linting passes
- [ ] On next prod release tag, `smoke-test` job appears under the Release run and exercises the correct variant
EOF
)"
```
Expected: PR URL printed.

- [ ] **Step 3: Verify on next release**

When the next release tag fires (manual trigger or `release-app` skill), confirm in the GitHub Actions Release run that the `smoke-test` job appears, picks the correct `app` target, and is gated on `release` succeeding.

---

## Verification Checklist

- [ ] `release` job exposes `license` output.
- [ ] `smoke-test` job runs only after `release` succeeds (`needs: release`).
- [ ] `smoke-test` calls `./.github/workflows/e2e-test.yml`.
- [ ] `app` resolves to `zenuml-lite@prod` / `zenuml-full@prod` / `diagramly@prod` based on `license`.
- [ ] `smoke-test.yml` (scheduled) and `deploy-cron-worker` are unchanged.
- [ ] No rollback / approval / environment work introduced.
