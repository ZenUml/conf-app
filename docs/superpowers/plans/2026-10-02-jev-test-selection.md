# Jev Test Selection Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement independent tasks, with integration review before completion. Steps use checkbox syntax.

**Goal:** Deliver observable Jev category selection, exact test plans/evidence, coordinated daily staging regression (Slack integration deferred), with narrowing disabled until evaluated.

**Architecture:** A checked-in behavior catalog connects Playwright tags to Jev questions. Selection artifacts feed discovery and plans; execution reports prove coverage. Shared staging transactions own environment concurrency, and daily regression uses full plans.

**Tech Stack:** Node ESM, native fetch, Playwright, Vitest, GitHub Actions, TypeSafe API, Slack Web API.

**Spec:** `docs/superpowers/specs/2026-10-02-jev-test-selection-design.md`

## Global Constraints

- All work in `../conf-app-jev-test-selection`, branch `feat/jev-test-selection`; do not alter other sessions' changes.
- Observation mode is the default; activation requires calibrated evaluation and explicit Actions configuration.
- Preserve smoke, fail closed to full coverage, keep unit/preview checks, and never introduce privileged PR-code execution.
- Every staging writer and deploy/test transaction participates in shared environment ownership.
- Daily regression fixes one SHA, handles four variants sequentially where the backend is shared, and alerts `#zenuml` without adding a release gate.
- TypeSafe credentials and Slack tokens stay in secrets; no customer data in artifacts.
- CI tooling needs Actions evidence, not product Mixpanel events.

## Task 1: Behavior catalog, tags and test plans

**Files:** Create `tests/e2e-tests/config/categories.mjs`, `scripts/test-selection/plan.mjs`, `scripts/test-selection/evidence.mjs`; modify `tests/e2e-tests/config/tags.ts`, live spec tags, Playwright reporting/config; add `tests/unit/testSelectionPlan.spec.ts`.

**Interfaces:** Catalog exports `CATEGORY_VERSION`, `CATEGORIES` (id, description, variants) and `VARIANTS`. Planner consumes selection JSON and Playwright JSON discovery; outputs schema-versioned plan with concrete IDs, file/title/project, variant, dependencies and shards. Evidence records executed IDs/status and source tree; incomplete evidence never qualifies for reuse.

- [ ] Add fixtures for Mermaid-only selection, all mode, unknown category, mandatory smoke, variant exclusion, serial grouping and empty selection.
- [ ] Run `pnpm exec vitest run tests/unit/testSelectionPlan.spec.ts`; confirm failures before implementation.
- [ ] Inventory every live spec; assign behavior and variant tags, retaining old tags. Extend closed-taxonomy policing.
- [ ] Implement discovery-to-plan mapping, deterministic nonempty shards, selection validation and concrete evidence reporter.
- [ ] Run focused tests and Playwright `--list --reporter=json` for live projects; verify full inventory is covered.
- [ ] Commit only owned files with `git add <paths>` and `git commit -m 'feat(ci): catalog integration test behavior and plans'`.

## Task 2: Jev classification and display

**Files:** Create `scripts/test-selection/classify.mjs`, `scripts/test-selection/labels.mjs`, `scripts/test-selection/replay.mjs`; add corresponding unit tests. Root integrates workflow invocation.

**Interfaces:** Classifier CLI accepts `--base`, `--head`, `--output`, `--mode observe|enabled`, reads `TYPESAFE_API_KEY`, emits `test-selection.json` and GitHub outputs `mode`, `grep`. It imports Task 1 catalog. Preserve v1 spec fields `schema_version`, `base_sha`, `head_sha`, `tested_tree`, `category_version`, `policy_version`, `model`, `categories`, `required`, `fallback_reason`. Record `execution_mode` so observation proposals cannot narrow actual execution. Labels consume the file and current PR head, update only generated labels and never remove `test:all`.

- [ ] Test complete response, uncertain category, missing key, malformed/missing answer, truncated diff, unknown path, shared path, renamed/deleted files and human full override.
- [ ] Run focused Vitest tests to demonstrate failure.
- [ ] Implement official TypeSafe `POST /v1/systemone` with finite timeout, response checks, cost/latency metadata and no raw secret logging. Keep shadow behavior default.
- [ ] Implement trusted label publication with head freshness checks, no code execution, preserved human override and summary output.
- [ ] Add historical replay command that reports probabilities, reviewed expected categories, misses and estimated selected test durations. Do not invent calibration success.
- [ ] Run unit tests, then one authorized live classification from the local ignored environment.
- [ ] Commit only owned files.

## Task 3: Slack run notifications

**Files:** Create `scripts/test-selection/notify.mjs`, tests `tests/unit/testSelectionNotify.spec.ts`, operator documentation `docs/ops/jev-test-selection.md`.

**Interfaces:** Notifier consumes a regression result JSON (run ID/attempt, SHA, URL, per-variant deployment/version/test statuses and failures) and optional persisted Slack message timestamp. Uses `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`; outputs notification metadata for recovery updates. No routine success message; delivery failures remain visible.

- [ ] Add mocked Slack tests for aggregated failure, silent success, recovery update, HTTP/API rejection and missing configuration.
- [ ] Run focused tests to show failure, then implement `chat.postMessage` / `chat.update` with response checks and bounded request timeout.
- [ ] Document exact Actions secrets/variables, observation/activation modes, manual full override, artifact locations and Slack bot setup.
- [ ] Run focused tests; do not send live Slack test messages until configured and meaningful.
- [ ] Commit only owned files.

## Task 4: CI transaction and daily regression

**Files:** Modify `.github/workflows/build-test-deploy.yml`, `staging-deploy.yml`, `e2e-test.yml`; create reusable staging transaction workflow, daily regression and trusted label/notification workflows as needed; add workflow contract tests.

**Interfaces:** Transaction owns shared staging concurrency from deploy through test/evidence. Nightly invokes variant transactions sequentially with one target SHA. PR/Main classification produces immutable artifact; planner binds it to the checked-out tree. Existing callers continue to function without selection input. Release callers retain current production behavior.

- [ ] Add contract assertions that all staging entry points hold ownership, nightly is full and preserves target SHA, selection defaults to observe, and no secrets reach untrusted code.
- [ ] Run focused contract tests before changes.
- [ ] Integrate classification artifact and summaries; remove paid Anthropic shadow path from this workflow rather than use a silent provider fallback.
- [ ] Integrate concrete planning/execution/evidence; distinguish selected versus full evidence and preserve current exact-tree reuse only where coverage is proven.
- [ ] Refactor deploy/test calls into coordinated transactions without nested ownership. Keep build jobs outside lock where feasible; preserve draft gate dependencies.
- [ ] Add daily 02:00 UTC and manual regression, full live inventory and variant/version verification, failure continuation and Slack aggregate/recovery integration.
- [ ] Validate YAML, reusable input contracts and GitHub expressions with actionlint where available; run tests and review changed job dependency graph.
- [ ] Commit only owned files.

## Task 5: Integration, evaluation and review

**Files:** All implementation files; plan completion ledger.

- [ ] Run all selector/catalog/planner/notifier/workflow tests and existing E2E taxonomy/selector tests.
- [ ] Run Playwright discovery in every applicable variant; inspect concrete plans and nonempty shard lists.
- [ ] Replay representative historical changes; record evidence without enabling narrowing or claiming recall from three samples.
- [ ] Review the complete diff for secrets/customer data, missing category coverage, stale evidence acceptance and staging races.
- [ ] Configure authorized TypeSafe Actions secret from ignored local `.env`; verify presence by name only. Discover existing Slack configuration without printing values; report any missing external setup.
- [ ] Prepare a reviewable feature commit/PR with actual validation and external prerequisites. No merge or production release is part of this task.

## Execution rulings

- The user requested execution; proceed without an additional choice-of-execution confirmation.
- The plan is intentionally observation-first. Initial thresholds are conservative provisional policy, not a claim of calibration.
- Shared Pages deployments require deploy/test transactions per variant; global ownership avoids mixed backend versions.

- User steering: Slack integration is deferred. Do not configure Slack credentials, wire notification workflows, or send messages. Preserve regression verdicts in Actions summaries/artifacts. The tested notifier module remains available for later integration.
