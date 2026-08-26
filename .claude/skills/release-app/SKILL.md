---
name: release-app
description: >
  Release ZenUML Forge apps (lite, full, diagramly, and/or asyncapi) to production via the full CI/CD pipeline.
  Reuses an existing fresh draft release when available (the common case after a recent merge),
  composes delta-derived release notes (replacing the auto-draft placeholder), publishes it to
  production, verifies with PVT, then runs a spot check — targeted coverage for what shipped this
  iteration (not keyword→skill matching alone). Falls back to manually
  triggering a fresh build only when no recent draft exists.
  Use when the user wants to release, deploy, ship, or push the lite, full, diagramly, or asyncapi Forge app to
  production. Triggers on "release lite", "release full", "release diagramly", "release asyncapi", "deploy to prod",
  "ship forge app", "push to production", "release forge app", "release app", or any request to
  promote staging builds to production for the conf-app project.
---

# Release Forge App to Production

End-to-end release pipeline for ZenUML Forge apps (lite, full, diagramly, and asyncapi) in the conf-app project.

## Arguments

Usage: `/release-app [lite] [full] [diagramly] [asyncapi]`

- **If no variant is specified, STOP and ASK which variant(s) to release. Do NOT release anything by default.** There is no "release all" default — an unscoped invocation is a question to the user, never a command to ship.
- The user must name one or more variants. Release **only** the named variant(s) — never a variant the user didn't name. `/release-app lite` releases lite and nothing else; do **not** continue to full (or any other tier) afterward. An explicit variant is not authorization for adjacent tiers.
- `asyncapi` has **no canary ordering or timing constraint** — it can be released at any time, independently of the other three (see "Variants & gates").

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

Three steps: **(1)** get a green build that produced fresh drafts, **(2)** release each named variant through its full publish→validate cycle, **(3)** report. Step 2 is a **per-variant loop** — complete 2.1–2.6 for one variant and confirm it passed before starting the next. Stop and report to the user if any step fails.

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

#### 1.2 Fallback — manually trigger a fresh build

Only do this if 1.1 found no usable draft. Trigger the workflow on `main` so
the resulting drafts are created from the current production branch:

```bash
gh workflow run build-test-deploy.yml --repo ZenUml/conf-app --ref main
```

This dispatch starts the normal build, staging deploy, E2E, and draft-release
jobs without changing `main`. Show the user that a fresh build is needed and
obtain explicit confirmation before dispatching it, then proceed to 1.3.

#### 1.3 Wait for the build workflow

Whether triggered by a real merge (1.1) or manual dispatch (1.2), wait for it to complete:

1. `gh run list --workflow=build-test-deploy.yml --branch=main -L 1` to find the run
2. `gh run watch <run-id>` (foreground) or `gh run watch <run-id> --exit-status` with `run_in_background: true` so you get a single completion notification
3. Verify the run succeeded — if it failed for any variant being released, report the failure and stop

The workflow runs: build + unit test → deploy variants to staging → E2E on staging → create draft releases (lite, full, diagramly, asyncapi). If only some variants succeeded (e.g. lite still deploying but full and diagramly done), you can publish the completed ones immediately — subject to the gates in "Variants & gates".

### Step 2 — Release each variant

Run 2.1–2.6 **per variant**, in canary order, completing one variant's full cycle before starting the next. Release **only the variant(s) the user named** (see Arguments). diagramly and lite for the same commit may go in one session (diagramly fully validated, then lite); **full is never in the same session as lite** (≥ 1-week soak); asyncapi is always its own release. Each variant gets its **own** notes — the per-variant delta can differ.

#### 2.1 Gate check

Run the gate check from "Variants & gates" with the exact draft tag selected in Step 1. If it returns `BLOCK`, stop and report; proceed only on explicit user override.

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

Set the notes on the still-draft release, then show them to the user as part of the publish confirmation (always confirm before publishing):

```bash
gh release edit <new-draft-tag> --repo ZenUml/conf-app --notes-file release-notes-{variant}.md
```

#### 2.4 Publish, then start PVT as soon as the deploy job is green

```bash
gh release edit <new-draft-tag> --repo ZenUml/conf-app --draft=false
```

This triggers the Release workflow (`release.yml`), which runs two distinct phases in one run:

1. **Deploy** — `Deploy Cron Worker to Production` and `v{tag} to production` (Cloudflare production publish + Forge production deploy). **This is the gate for PVT.**
2. **Prod smoke** — `Smoke Test (Prod) — {variant} / auth bootstrap` and four `shard N/4` jobs, which take several more minutes.

**Do not wait for the whole run before starting 2.5.** The new code is live the moment the deploy job reports `success`; the smoke shards afterwards test that same live deployment, so blocking PVT on them only delays validation of a build that is already serving users.

```bash
# Poll job-level state, not run-level. Start PVT when the "to production" job is success.
gh run view <run-id> --repo ZenUml/conf-app --json status,jobs \
  -q '"run=\(.status)", (.jobs[] | "\(.conclusion // .status)\t\(.name)")'
```

- **Deploy job `success`** → **go straight to 2.5** and run PVT while the smoke shards continue.
- **Deploy job `failure`** → report and stop. Nothing was deployed; PVT would test the previous version.
- In parallel, keep watching the run to completion (`gh run watch <run-id> --exit-status` in the background) and fold the smoke result into the Step 3 report.

**Judge by job, not by run.** A run whose deploy jobs are green and whose only red is a prod-smoke shard **did deploy successfully** — report the shard failure as a separate line item, do not describe the release as failed. Read the failing shard's log before characterizing it (`gh api repos/ZenUml/conf-app/actions/jobs/<jobId>/logs`); a `page.waitForResponse` timeout in a smoke spec is a test-side failure, distinct from a broken deployment.

#### 2.5 Validate — PVT (MANDATORY)

**Not optional. Start it as soon as the 2.4 deploy job reports `success` — do not wait for the prod smoke shards, and do NOT ask the user whether to run it.**

- **Lite**: `/pvt lite`
- **Full**: `/pvt full`
- **Diagramly**: `/pvt diagramly`
- **AsyncAPI**: run against the prod tenant **`async-prd.atlassian.net`**. Minimal checks: (a) the "My API Documents" dashboard or an asyncapi macro renders; (b) when the delta touches AI features, the `/diagramly/*` request origin is `https://zenapi.zenuml.com`.

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

**Runs automatically after PVT. Do not skip it.** General workflow, environment selection, and verification methods: **spot-check** skill.

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

Summarize each released variant:

```
## Release Report: v{version}-{variant}
- Release notes set (replaced placeholder): ✓
- Draft published: ✓
- Release workflow — deploy jobs: ✓
- Release workflow — prod smoke shards: ✓ | <N/4 failed: shard + one-line cause>
- PVT (Mermaid smoke): PASS | FAIL
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
- The build workflow supports `workflow_dispatch`; use it on `main` only when no usable draft exists.
- Draft releases are only created on `main` (not on PRs or other branches).
- lite/full/diagramly are Forge apps on the same production site (`zenuml.atlassian.net`); asyncapi is a separate app whose prod tenant is `async-prd.atlassian.net` (workflow prod-smoke still skipped, so the manual PVT in 2.5 is its only production check; the e2e account has had access since 2026-08-21).
- Always confirm with the user before manually dispatching a fresh build or publishing releases.
- All order/timing rules live in **"Variants & gates"** — the canary order (diagramly → lite → full), the lite-needs-diagramly prerequisite, and the full ≥ 1-week soak. Don't restate them; reference that section.
