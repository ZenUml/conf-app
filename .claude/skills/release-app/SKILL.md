---
name: release-app
description: >
  Release ZenUML Forge apps (lite, full, diagramly, and/or asyncapi) to production via the full CI/CD pipeline.
  Reuses an existing fresh draft release when available (the common case after a recent merge),
  composes delta-derived release notes (replacing the auto-draft placeholder), publishes it to
  production, verifies with PVT, then runs a spot check — targeted coverage for what shipped this
  iteration (not keyword→skill matching alone). Falls back to manually
  triggering a fresh build only when no recent draft exists. Supports a read-only `preflight`
  mode that reports exactly what an existing candidate would release without changing GitHub,
  deploying, or running production validation.
  Use when the user wants to release, deploy, ship, or push the lite, full, diagramly (or dia), or asyncapi (or async/api)
  Forge app to production. Triggers on "release lite", "release full", "release diagramly", "release dia", "release asyncapi", "release async", "release api", "deploy to prod",
  "ship forge app", "push to production", "release forge app", "release app", "release-app preflight", or any request to
  promote staging builds to production for the conf-app project.
---

# Release Forge App to Production

End-to-end release pipeline for ZenUML Forge apps (lite, full, diagramly, and asyncapi) in the conf-app project.

## Arguments

Usage: `/release-app [preflight] [lite] [full] [diagramly|dia] [asyncapi|async|api]`

Aliases are officially supported: `dia` means `diagramly`, and `async` or `api`
means `asyncapi`. Normalize aliases to their canonical variant names before
selecting drafts, checking prerequisites, composing notes, or publishing.

- **If no variant is specified, STOP and ASK which variant(s) to release. Do NOT release anything by default.** There is no "release all" default — an unscoped invocation is a question to the user, never a command to ship.
- The user must name one or more variants. Release **only** the named variant(s) — never a variant the user didn't name. `/release-app lite` releases lite and nothing else; do **not** continue to full (or any other tier) afterward. An explicit variant is not authorization for adjacent tiers.
- `asyncapi` has **no canary ordering or timing constraint** — it can be released at any time, independently of the other three (see "Variants & gates").
- `preflight` is a read-only mode, not a release. `/release-app preflight full` answers: "If we published today, exactly what would Full release to production?" It must name at least one variant and analyzes only the named variant(s).

## Preflight mode (read-only)

`preflight` means an evidence-backed production payload preview. It identifies the exact existing
draft, commit, release delta, user-facing themes, release-notes body, and focused-check plan that
would be used by a release **today**. It also reports whether the normal prerequisite gate is
currently satisfied. A blocked gate is an outcome to report, not a reason to hide the delta.

For each requested variant, preflight must:

1. Select the newest matching draft that is within the normal 24-hour freshness window and verify
   the source build's relevant deploy and draft jobs. If no usable draft exists, report that there
   is no exact candidate; do not dispatch a workflow or invent a payload from local `HEAD`.
2. Resolve the draft tag/version and pinned commit SHA, then find the previous published tag for
   the same variant and compute the complete commit delta between them. Read diffs where the commit
   subject is not enough to establish product intent.
3. Run the normal prerequisite script and report its exact `OK` or `BLOCK` result. In preflight,
   continue delta analysis after `BLOCK`; the gate remains blocking for an actual release.
4. Categorize every delta commit using the 2.6 triage rules, including variant reachability, and
   write the targeted spot-check assertions that would be executed after a real release.
5. Render the release-notes preview from that same delta. Do not edit the draft or create a local
   notes file as part of preflight; the draft's placeholder must remain untouched.

The preflight report must clearly separate:

- **Would ship:** the exact draft tag/version, target commit, previous tag, delta themes, and
  release-notes preview.
- **Gate:** whether publishing is currently allowed, including any remaining soak time.
- **Would validate:** the focused assertions planned from the delta; these are **not executed** in
  preflight. Do not open a browser, run PVT, run a spot check, publish, edit release metadata, or
  trigger CI from preflight.

Preflight is complete when the user can decide whether the identified candidate is the intended
production payload. It does not require the gate to pass, but it must never be presented as an
approval to publish when the gate is blocked.

## Variants & gates

Single source of truth for which sites each variant targets and the order/timing rules that gate publishing. Every per-variant gate check (Step 2.1) runs the bash below — don't restate these rules elsewhere.

### Sites and tags

| Variant | Staging Site | Production Site | Draft Tag Pattern |
|---------|-------------|-----------------|-------------------|
| diagramly | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-diagramly` |
| lite | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-lite` |
| full | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-full` |
| asyncapi | `asyncapi-stg.atlassian.net` | `async-prd.atlassian.net` (see PVT note in 2.5) | `v{version}-asyncapi` |

lite, full, and diagramly are Forge apps deployed to the same Confluence site (`zenuml.atlassian.net`), distinguished by their addon keys and macro names. asyncapi is a separate Forge app ("AsyncAPI for Confluence"); it shares the `conf-lite` Cloudflare Pages project for now. Its production tenant is **`async-prd.atlassian.net`** (verified 2026-07-12: cloudId `1ec8c87a-4984-41a7-975b-82160f5497a5`, active `my-api` COMMERCIAL license, Forge install Up-to-date — the old "no prod tenant" claim was stale). `release.yml`'s built-in prod smoke still skips asyncapi (workflow condition unchanged), so the manual PVT in Step 2.5 is the ONLY production check this variant gets.

### Canary order — diagramly → lite → full; asyncapi is independent

Releases go low-risk first, by user count. Draft tags have variant-specific timestamps, so their version strings do **not** match. A canary validates another variant only when both release tags resolve to the **same commit SHA**:

1. **Diagramly** — first; **fewest users**, so it's the canary. Its publish + PVT + spot check prove the build is safe on real production before more users are exposed.
2. **Lite** — second. Free users; a larger base than Diagramly.
3. **Full** — last, and **never in the same session as lite**. **Paying users** — a regression here hits customers who pay. Full ships only after lite for the **same commit** has soaked in production for **≥ 1 week**.

**asyncapi is outside the canary** — separate app, no shared user base — so it has no prerequisite and no soak; release it any time.

### Prerequisite gate

Before publishing a tier, confirm its prerequisite:

| Publishing | Prerequisite (same commit SHA) |
|---|---|
| diagramly | none — it's the canary |
| lite | A Diagramly release for the draft's commit SHA is **published** |
| full | A Lite release for the draft's commit SHA was **published ≥ 7 days ago** (hard soak: ≥ 1 week = 604800s) |
| asyncapi | none — release any time, no soak |

(`full`'s check on `lite` is transitive — `lite` can't have published without `diagramly`.) The 1-week full gate is a **hard soak**: full for a commit therefore **cannot** be released in the same run as lite — it is always a separate, later invocation.

There is **no "release all variants" run.** Diagramly and lite for one commit may be released in the same session (diagramly first, validated, then lite). Full always waits out the soak; asyncapi is released on its own whenever asked.

### The gate check (run in Step 2.1)

```bash
.claude/skills/release-app/scripts/check-prerequisite.sh "<variant>" "<draft-tag>"
```

The script first requires the draft's `targetCommitish` to be a full, resolvable commit SHA. This blocks legacy drafts that still target a moving branch such as `main`, including canary and independent releases. For Lite and Full it then searches published prerequisite releases by variant, resolves each published tag to the commit it actually shipped, and requires an exact SHA match. Full additionally enforces the 604800-second soak from that matching Lite release's `publishedAt`.

**Proceed only when the script exits zero with an explicit `OK:` line.** Treat anything else — a nonzero exit, `BLOCK:` line, command error, or empty output — as a stop: report the unsafe draft or missing/young prerequisite and, for the full soak, how many days remain until the 1-week mark. Override only if the user explicitly says so (e.g. a Full-only hotfix).

## Pipeline

In normal release mode, three steps are required: **(1)** get a green build that produced fresh drafts, **(2)** release each named variant through its full publish→validate cycle, **(3)** report. Step 2 is a **per-variant loop** — complete 2.1–2.6 for one variant and confirm it passed before starting the next. Stop and report to the user if any step fails. Preflight follows the read-only workflow above and does not enter the publish or validation steps.

### Step 1 — Get a green build

The build (`build-test-deploy.yml` on `main`) deploys all variants to staging, runs E2E, and creates the draft releases you publish in Step 2. Most of the time a recent merge already ran it — reuse those drafts; don't push a fake commit to re-trigger.

#### 1.1 Reuse a fresh draft (normal path)

For each requested variant:

```bash
gh release list --repo ZenUml/conf-app --limit 20 \
  | awk '$2=="Draft" && $1 ~ /-{variant}$/ {print $1; exit}'
```

If a draft tag is returned, confirm it's recent (within the last 24 hours) and that its source workflow run succeeded:

```bash
# Get the run that produced the draft (drafts are created at the end of build-test-deploy.yml)
gh run list --repo ZenUml/conf-app --workflow=build-test-deploy.yml --branch=main --limit 1 \
  --json databaseId,status,conclusion,createdAt
```

- If `status=completed` and `conclusion=success` for the relevant variant's `Deploy: {Variant}` and `Draft: {Variant}` jobs → **go to Step 2** and publish that draft.
- If `status=in_progress` → **wait for it (1.3)**, then publish.
- If no fresh draft exists (last drafts are stale or absent) → fall back to **1.2** to trigger a fresh build.

Use `gh run view <run-id> --json jobs` to inspect per-variant job conclusions when there's any doubt.

#### 1.2 Fallback — manually trigger a fresh build (release mode only)

Only do this in normal release mode if 1.1 found no usable draft. Trigger the workflow on `main` so
the resulting drafts are created from the current production branch:

```bash
gh workflow run build-test-deploy.yml --repo ZenUml/conf-app --ref main
```

This dispatch starts the normal build, staging deploy, E2E, and draft-release
jobs without changing `main`. Show the user that a fresh build is needed and
obtain explicit confirmation before dispatching it, then proceed to 1.3.

#### 1.3 Wait for the build workflow (release mode)

Whether triggered by a real merge (1.1) or manual dispatch (1.2), wait for it to complete:

1. `gh run list --workflow=build-test-deploy.yml --branch=main -L 1` to find the run
2. `gh run watch <run-id>` (foreground) or `gh run watch <run-id> --exit-status` with `run_in_background: true` so you get a single completion notification
3. Verify the run succeeded — if it failed for any variant being released, report the failure and stop

The workflow runs: build + unit test → deploy variants to staging → E2E on staging → create draft releases (lite, full, diagramly, asyncapi). If only some variants succeeded (e.g. lite still deploying but full and diagramly done), you can publish the completed ones immediately — subject to the gates in "Variants & gates".

### Step 2 — Release each variant (release mode)

Run 2.1–2.6 **per variant**, in canary order, completing one variant's full cycle before starting the next. Release **only the variant(s) the user named** (see Arguments). diagramly and lite for the same commit may go in one session (diagramly fully validated, then lite); **full is never in the same session as lite** (≥ 1-week soak); asyncapi is always its own release. Each variant gets its **own** notes — the per-variant delta can differ.

#### 2.1 Gate check

Run the gate check from "Variants & gates" with the exact draft tag selected in Step 1. In normal
release mode, if it returns `BLOCK`, stop and report; proceed only on explicit user override. In
preflight mode, record the `BLOCK` and continue through the delta, triage, and notes-preview work;
never treat preflight as an override and never publish from it.

#### 2.2 Establish the release delta

Find this variant's draft tag and its previous **published** tag, then list the commits between them. **This single delta feeds both the release notes (2.3) and the spot check (2.6) — compute it once, here.**

```bash
# This release's draft tag
gh release list --repo ZenUml/conf-app --limit 30 --json tagName,isDraft \
  -q "[.[]|select(.isDraft and (.tagName|test(\"-{variant}\$\")))][0].tagName"

# Previous PUBLISHED tag for the same variant (the delta's "since" point)
gh release list --repo ZenUml/conf-app --exclude-drafts --limit 30 --json tagName \
  -q "[.[]|select(.tagName|test(\"-{variant}\$\"))][0].tagName"
```

```bash
git fetch --tags
git log <prev-published-tag>..<new-draft-tag> --oneline
```

Read the log **as product intent**, not keyword soup: group commits into themes (paywall modal, fullscreen bridge, DrawIO chrome, OpenAPI viewer, editor modal), and note which user-visible surfaces and macro types are implicated. For any commit not self-explanatory from its subject, read the diff (`git show <sha>`) before relying on it.

#### 2.3 Compose notes from the delta, set on the draft

The draft was auto-created with a **generic placeholder body** (`"This is a draft release for the Lite version of the plugin."`). You **MUST replace it with real, delta-derived notes before publishing** — never ship the placeholder. This is not optional.

Turn the 2.2 commit log into **user-facing release notes**, not a raw commit dump:

- Lead with **behavioral / user-visible changes** (what a Confluence user or macro author will notice) — reuse the `behavioral` rows from the 2.6 triage table.
- Then **fixes** (bugs resolved).
- Fold `infra/test/docs` and pure-`instrumentation` commits into a short trailing line (or omit) — they are not user-facing.
- Group by theme/surface (paywall, fullscreen, DrawIO, OpenAPI, editor…), not one bullet per commit.
- Note the variant and version. Keep it concise and concrete.

In preflight, render this body as the release-notes preview and do not edit the draft. In normal
release mode, write the body to a file and set it on the draft as described below.

Write the body to a file, e.g. `release-notes-{variant}.md`:

```markdown
## v{version}-{variant}

### Changes
- <user-facing change grouped by theme>
- …

### Fixes
- <bug fix>

_Internal: <one line for infra/test/docs/instrumentation, or omit>_
```

If 2.2 shows **no product commits** since the previous published tag (e.g. a re-trigger), say so (`- Maintenance release; no user-facing changes.`) rather than leaving the placeholder.

In normal release mode, set the notes on the still-draft release, then show them to the user as
part of the publish confirmation (always confirm before publishing):

```bash
gh release edit <new-draft-tag> --repo ZenUml/conf-app --notes-file release-notes-{variant}.md
```

#### 2.4 Publish, then start the spot check as soon as the deploy job is green

This section is **release mode only**. Never publish or start a release workflow from preflight.

```bash
gh release edit <new-draft-tag> --repo ZenUml/conf-app --draft=false
```

This triggers the Release workflow (`release.yml`), which runs two distinct phases in one run:

1. **Deploy** — `Deploy Cron Worker to Production` and `v{tag} to production` (Cloudflare production publish + Forge production deploy). **This is the gate for the spot check (2.6).**
2. **Prod smoke** — `Smoke Test (Prod) — {variant} / auth / auth bootstrap` and five `shard N/5` jobs. Since ADR-0006 this runs only the `@smoke` tier (one insert-and-render per macro type, one edit, one embed paste — 7 tests on Lite, fewer where a macro is stripped); the paywall, byline and deeplink specs it leaves out ran on staging in the same commit's build, and the nightly `smoke-test.yml` still runs the whole suite on production.

**Do not wait for the whole run before starting 2.6.** The new code is live the moment the deploy job reports `success`; the smoke shards afterwards test that same live deployment and ARE the PVT (2.5), so the delta spot check runs while they finish rather than after.

```bash
# Poll job-level state, not run-level. Start the spot check when the "to production" job is success.
gh run view <run-id> --repo ZenUml/conf-app --json status,jobs \
  -q '"run=\(.status)", (.jobs[] | "\(.conclusion // .status)\t\(.name)")'
```

- **Deploy job `success`** → **go straight to 2.6** (spot check) while the smoke shards continue; 2.5 resolves itself from the smoke result.
- **Deploy job `failure`** → report and stop. Nothing was deployed; a spot check would test the previous version.
- In parallel, keep watching the run to completion (`gh run watch <run-id> --exit-status` in the background); its smoke verdict is the PVT line of the Step 3 report.

**Judge by job, not by run.** A run whose deploy jobs are green and whose only red is a prod-smoke shard **did deploy successfully** — report the shard failure as a separate line item, do not describe the release as failed. Read the failing shard's log before characterizing it (`gh api repos/ZenUml/conf-app/actions/jobs/<jobId>/logs`); a `page.waitForResponse` timeout in a smoke spec is a test-side failure, distinct from a broken deployment.

#### 2.5 Validate — PVT (MANDATORY; the release smoke IS the PVT for lite/full/diagramly)

This section is **release mode only**. Preflight does not run PVT because nothing has been deployed.

**Not optional, and for lite/full/diagramly not manual either (ADR-0007).** The release run's `Smoke Test (Prod) — {variant}` jobs run the `@smoke` tier against the tag just deployed — one insert-and-render per macro type, Mermaid included, which is exactly what `/pvt` used to drive by hand. Its verdict is the PVT:

- **All smoke shards `success`** → `PVT: PASS`. Do not also run `/pvt`; it would re-prove the same render on the same tag.
- **A smoke shard `failure`** → read that shard's log before deciding (`gh api repos/ZenUml/conf-app/actions/jobs/<jobId>/logs`). A test-side failure (a `waitForResponse` timeout, a selector miss) is not a broken deployment — run the manual `/pvt {variant}` **once** to disambiguate, and record both results. A render failure on the live tag is `PVT: FAIL`; report and stop.
- **Shards reaped or never ran** (auth bootstrap failed, run cancelled) → fall back to the manual `/pvt {variant}`.

`/pvt lite` / `/pvt full` / `/pvt diagramly` therefore remain the fallback and the disambiguator, not the routine step.

- **AsyncAPI**: the release smoke still skips this variant, so its PVT stays manual — run against the prod tenant **`async-prd.atlassian.net`**. Minimal checks: (a) the "My API Documents" dashboard or an asyncapi macro renders; (b) when the delta touches AI features, the `/diagramly/*` request origin is `https://zenapi.zenuml.com`.

  **Access works — do NOT record this as blocked.** robot1yanhui holds Confluence User on `async-prd` (granted 2026-08-21), and `agent-browser --session conf-app --restore=stg` reaches the tenant directly. An earlier version of this file said the account had none and told you to record `PVT: BLOCKED`; that was true on 2026-07-12 and is stale. Verified again 2026-08-26 on the `v2026.08.260408-asyncapi` release.

  The dashboard route needs the trailing module key — without it Confluence serves its own "We can't find that page":

  ```
  /wiki/spaces/<SPACE>/apps/<appId>/<pageId>/zenuml-asyncapi-dashboard
  ```

  Read it off the space sidebar rather than hand-building it (`[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'My API Documents').getAttribute('href')`) — the appId and pageId segments are per-install. On `async-prd`/`SD` the appId is `49017727-af19-4ab6-8d5a-7d28108936b6`.

  Two macro types ship in this variant (asyncapi + OpenAPI); the graph, sequence and embed macros are stripped from its manifest, so anything graph-shaped in the delta is `Not testable in asyncapi`. Pages carrying both types live in `SD` on `async-prd`.

  The release workflow's own prod smoke skips asyncapi (`release.yml`: `needs.release.outputs.license != 'asyncapi'`), so this PVT is the only production check — never skip it.

Report PVT results to the user.

#### 2.6 Validate — Spot check (targeted coverage for this release)

**Runs as soon as the deploy job is green — in parallel with the smoke (2.5), not after it. Do not skip it.** General workflow, environment selection, and verification methods: **spot-check** skill.

In preflight, stop after writing the triage table and assertions. Mark them as planned/not run;
do not touch the browser or claim PASS/FAIL. A real release executes them after PVT.

A spot check here is **not** "find a matching `/pvt-*` skill." It means: **understand what shipped in this iteration** for this variant, then **run the smallest set of checks that deliberately exercises that delta**. Always target **the same variant as this release**.

**Triage table — required before you may write the plan or declare N/A.** For every commit in the 2.2 delta, assign one category:

| Category | Criteria | Plan action |
|---|---|---|
| `behavioral` | Changes runtime behavior visible to a Confluence user or macro consumer | Must produce at least one `[ ]` assertion in the plan |
| `instrumentation` | Adds/changes analytics events or properties; no UI change | May produce an assertion (event fires + properties) or be skipped with justification |
| `infra/test/docs` | CI config, test files, migration scripts, documentation only | Write `Skipped: <subject> — <reason>` |

A commit categorized as `infra/test/docs` or `instrumentation` that has **any** runtime code change (touches `src/` or `functions/` outside test dirs) must be re-categorized as `behavioral` unless `git show <sha>` confirms the runtime path is never reachable from user-facing flows.

**Variant reachability check (per commit):** a `behavioral` commit may still be unreachable in the variant being released — e.g. the embed macro module is removed from the Diagramly manifest, so `src/forge-embed-editor.ts` changes ship in the Diagramly bundle but cannot be triggered through Diagramly. When this applies, the commit stays `behavioral` but the assertion is replaced with `Not testable in <variant> — <reason>`. Don't silently drop it; it must appear in the triage table and the final report.

You may write `Spot check: N/A — <justification>` **only** if **every** commit is `infra/test/docs`. One `instrumentation` or `behavioral` commit closes the N/A path (write a plan entry even if the assertion is just "event fires with correct properties"). The triage table must appear in your response **before** the plan or any N/A declaration — it is a required artifact, not internal reasoning.

**Write the plan — BEFORE touching the browser.** Follow the **spot-check** skill plan format:

```
Spot check plan for v{new-tag}

Commit: <subject>
  - [ ] <specific observable assertion>  [method]
  - [ ] <specific observable assertion>  [method]

Skipped: <subject> — <reason, e.g. "test-only change, no production behaviour">
```

Good entry (observable, derived from the diff):

```
Commit: Track paywall advocacy draft preview expand and collapse in Mixpanel
  - [ ] Clicking draft toggle (expand) fires Mixpanel `advocacy_draft_preview_clicked`
        with `expanded: true` and `ui_component: "modal"`  [Playwright + request intercept]
  - [ ] Clicking draft toggle (collapse) fires Mixpanel `advocacy_draft_preview_clicked`
        with `expanded: false` and `ui_component: "modal"`  [Playwright + request intercept]
```

Bad entry (vague; keyword not diff):

```
Commit: Track paywall advocacy draft preview expand and collapse in Mixpanel
  - [ ] Run /pvt-paywall  ← BAD: a recipe call, not an assertion
```

Rules:
- Each `[ ]` must be independently pass/fail checkable. If you can't state what "pass" looks like before running, it's too vague.
- `/pvt-*` skills may appear as **method shortcuts** once an assertion is written (`/pvt-paywall` covers assertions A, B, C), never as a substitute for writing the assertion first.

**Execute the plan.** Follow the spot-check skill execution workflow. Run planned checks **sequentially**, deduplicating redundant steps. Invoke `/pvt-*` skills when they align with the plan. If you planned `/pvt-X` but its skill file doesn't exist, log `sub-skill /pvt-X not yet implemented`, then substitute manual/custom steps if the delta still needs that coverage — a missing file is a **skipped recipe**, not "no test needed."

Optional keyword hints (secondary — not exhaustive or sufficient on their own):

| Themes (commit / area hints) | Often covered by |
|---|---|
| paywall, upgrade, css, persona, modal | `/pvt-paywall` |
| fullscreen, fullscreen-bridge, viewport, expanded viewer | `/pvt-fullscreen` |
| editor, editor-ui, codemirror, edit path | `/pvt-edit` |
| swagger, openapi | `/pvt-swagger` |
| graph, drawio | `/pvt-drawio` |

**Collect results for Step 3.** Record **pass | fail | skipped** per planned check (skill name or short description). If the delta was genuinely tiny (e.g. docs-only), state **"Focused tests: N/A — no product behaviour changed"** with a one-line justification — not "no keywords matched."

### Step 3 — Report

For `preflight`, report instead:

```
## Release Preflight: v{version}-{variant}
- Candidate draft: <tag> — <fresh/stale/not found>
- Target commit: <full SHA>
- Source build: <relevant deploy and draft jobs>
- Previous published tag: <tag>
- Release delta: <themes / surfaces touched>
- Gate: READY | BLOCKED — <exact result and remaining soak, if any>
- Release notes preview:
  <body that would replace the placeholder>
- Focused checks planned (not run):
  - <assertion>: NOT RUN
- External changes: none
```

Do not call a preflight `PASS` when its gate is blocked. Use `READY` only when the exact candidate
is identified and the normal gate returns `OK`.

Summarize each released variant:

```
## Release Report: v{version}-{variant}
- Release notes set (replaced placeholder): ✓
- Draft published: ✓
- Release workflow — deploy jobs: ✓
- Release workflow — prod smoke shards (`@smoke` tier): ✓ | <N/5 failed: shard + one-line cause>
- PVT (release `@smoke` on the tag; manual `/pvt` only for asyncapi or to disambiguate a red shard): PASS | FAIL
- Release delta (one line): <themes / surfaces touched>
- Focused tests (targeted coverage for this delta):
  - <check 1 — skill or custom>: PASS | FAIL | SKIPPED — <note>
  - <check 2>: …
  (or: N/A — docs-only / no product behaviour in this tag — <brief justification>)
```

## Error handling

- **Build workflow fails (Step 1)**: report which job failed, link to the run, stop.
- **Release workflow fails (2.4)**: report the failure, link to the run — the draft was already published, so the user may need to investigate manually.
- **PVT or spot check fails (2.5 / 2.6)**: report which check failed and what was observed. Do **not** roll back the variant that already shipped (it's live — investigate, don't unpublish) or impose a standing freeze on the whole pipeline. But you **must halt this session** — do not publish the next variant in canary order. A failed canary (e.g. diagramly's PVT or spot check) is exactly the signal the canary exists to catch; proceeding to lite or full would expose a larger user base to a flagged build. Resume only after the failure is resolved or the user explicitly overrides.

## Notes

- **Never release by default.** If no variant is named, ASK. Release only the variant(s) the user explicitly names; an explicit variant does NOT authorize any other tier (releasing lite does not license releasing full afterward).
- **Never publish the placeholder body (2.3).** Always replace the auto-draft `"This is a draft release…"` body with delta-derived notes before `--draft=false`. Notes and spot check share the one delta from 2.2.
- **Always check for a fresh draft first (1.1).** A merge to main that completed in the last 24 hours may already have produced the drafts you need — reuse them. A manual dispatch when fresh drafts exist wastes ~15 min of CI and gains nothing.
- **Preflight is read-only.** It previews the exact candidate payload and derived notes/checks for today; it never dispatches CI, edits a draft, publishes, opens a browser, or runs PVT/spot checks.
- The build workflow supports `workflow_dispatch`; use it on `main` only when no usable draft exists.
- Draft releases are only created on `main` (not on PRs or other branches).
- lite/full/diagramly are Forge apps on the same production site (`zenuml.atlassian.net`); asyncapi is a separate app whose prod tenant is `async-prd.atlassian.net` (workflow prod-smoke still skipped, so the manual PVT in 2.5 is its only production check; the e2e account has had access since 2026-08-21).
- Always confirm with the user before manually dispatching a fresh build or publishing releases.
- All order/timing rules live in **"Variants & gates"** — the canary order (diagramly → lite → full), the lite-needs-diagramly prerequisite, and the full ≥ 1-week soak. Don't restate them; reference that section.
