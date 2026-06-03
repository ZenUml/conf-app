---
name: release-app
description: >
  Release ZenUML Forge apps (lite, full, and/or diagramly) to production via the full CI/CD pipeline.
  Reuses an existing fresh draft release when available (the common case after a recent merge),
  composes delta-derived release notes (replacing the auto-draft placeholder), publishes it to
  production, verifies with PVT, then runs a spot check — targeted coverage for what shipped this
  iteration (not keyword→skill matching alone). Falls back to triggering a
  fresh build via a changelog push only when no recent draft exists.
  Use when the user wants to release, deploy, ship, or push the lite, full, or diagramly Forge app to
  production. Triggers on "release lite", "release full", "release diagramly", "deploy to prod",
  "ship forge app", "push to production", "release forge app", "release app", or any request to
  promote staging builds to production for the conf-app project.
---

# Release Forge App to Production

End-to-end release pipeline for ZenUML Forge apps (lite, full, and/or diagramly) in the conf-app project.

## Arguments

Usage: `/release-app [lite] [full] [diagramly]`

- If no variant specified, release **all three** (lite, full, and diagramly).
- User can specify one or more variants to release only those.

## Variant Configuration

| Variant | Staging Site | Production Site | Draft Tag Pattern |
|---------|-------------|-----------------|-------------------|
| lite | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-lite` |
| full | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-full` |
| diagramly | `zenuml-stg.atlassian.net` | `zenuml.atlassian.net` | `v{version}-diagramly` |

All three variants are Forge apps deployed to the same Confluence sites. On production (`zenuml.atlassian.net`), all three coexist — they're distinguished by their addon keys and macro names.

## Pipeline Steps

Execute these steps sequentially. Stop and report to the user if any step fails.

### Step 1: Check for an existing fresh draft release

Most of the time you arrive here right after merging a PR to main, which already triggered `build-test-deploy.yml` and produced fresh draft releases. Reuse those — don't push a fake commit just to re-trigger the build.

For each requested variant:

```bash
gh release list --repo ZenUml/conf-app --limit 20 \
  | awk '$2=="Draft" && $1 ~ /-{variant}$/ {print $1; exit}'
```

If a draft tag is returned, also confirm it's recent (within the last hour or two) and that its source workflow run succeeded:

```bash
# Get the run that produced the draft (drafts are created at the end of build-test-deploy.yml)
gh run list --repo ZenUml/conf-app --workflow=build-test-deploy.yml --branch=main --limit 1 \
  --json databaseId,status,conclusion,createdAt
```

- If `status=completed` and `conclusion=success` for the relevant variant's `Deploy: {Variant}` and `Draft: {Variant}` jobs → **skip to Step 3** and publish that draft.
- If `status=in_progress` → **wait for it (Step 2b)**, then publish.
- If no fresh draft exists (last drafts are stale or absent) → fall back to **Step 2a** to trigger a fresh build.

Use `gh run view <run-id> --json jobs` to inspect per-variant job conclusions when there's any doubt.

### Step 2a (fallback): Trigger a fresh build with a changelog push

Only do this if Step 1 found no usable draft. The "Build, Test and Draft Release" workflow has no `workflow_dispatch`, so a push to main is the only way to retrigger it.

1. `cd` to the conf-app project root
2. Append to `CHANGELOG.md` with today's date and a release entry:
   ```
   ## [YYYY-MM-DD] - Release
   - Triggered release pipeline for {variants}
   ```
3. Stage, commit (message: `chore: trigger release pipeline`), and push to main **only after explicit user confirmation**
4. Proceed to Step 2b

### Step 2b: Wait for the Build Workflow run

Whether the run was triggered by a real merge (Step 1) or your changelog push (Step 2a), wait for it to complete:

1. `gh run list --workflow=build-test-deploy.yml --branch=main -L 1` to find the run
2. `gh run watch <run-id>` (foreground) or `gh run watch <run-id> --exit-status` with `run_in_background: true` so you get a single completion notification
3. Verify the run succeeded — if it failed for any variant being released, report the failure and stop

The workflow runs these jobs on main:
- Build and unit test
- Deploy 3 variants to staging (lite, full, diagramly)
- E2E tests on all 3 staging variants
- Create 3 draft releases (lite, full, diagramly)

If only some variants succeeded (e.g. lite is still deploying but full and diagramly are done), you can publish the completed ones immediately.

### Step 3: Add release notes, then publish the Draft Release

The draft releases are auto-created by the build workflow with a **generic placeholder body** (`"This is a draft release for the Lite version of the plugin."`). You **MUST replace that with real release notes before publishing** — do not ship a release whose notes are the placeholder. This is not optional.

For each variant being released:

#### 3.1 Find the draft tag and the previous published tag

```bash
# This release's draft tag
gh release list --repo ZenUml/conf-app --limit 30 --json tagName,isDraft \
  -q "[.[]|select(.isDraft and (.tagName|test(\"-{variant}\$\")))][0].tagName"

# Previous PUBLISHED tag for the same variant (the notes' "since" point)
gh release list --repo ZenUml/conf-app --exclude-drafts --limit 30 --json tagName \
  -q "[.[]|select(.tagName|test(\"-{variant}\$\"))][0].tagName"
```

#### 3.2 Compose the release notes from the delta

This is the **same delta** you establish in Step 5.5 Section 1 — compute it once and reuse it for both notes and the spot check.

```bash
git fetch --tags
git log <prev-published-tag>..<new-draft-tag> --oneline
```

Turn the commit log into **user-facing release notes**, not a raw commit dump:

- Lead with **behavioral / user-visible changes** (what a Confluence user or macro author will notice) — reuse the `behavioral` rows from the Step 5.5 triage table.
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

If `git log` shows **no product commits** since the previous published tag (e.g. the build was a re-trigger), say so in the notes (`- Maintenance release; no user-facing changes.`) rather than leaving the placeholder.

#### 3.3 Set the notes on the draft (still a draft at this point)

```bash
gh release edit <new-draft-tag> --repo ZenUml/conf-app --notes-file release-notes-{variant}.md
```

Show the composed notes to the user as part of the publish confirmation (per "Always confirm before publishing").

#### 3.4 Publish

```bash
gh release edit <new-draft-tag> --repo ZenUml/conf-app --draft=false
```

This triggers the Release workflow (`release.yml`) which:
- Builds and publishes to Cloudflare production
- Deploys to Forge production

If releasing multiple variants, set notes + publish them one at a time and wait for each Release workflow to complete before publishing the next. Each variant gets its **own** notes (the per-variant delta can differ).

### Step 4: Wait for Release Workflow

1. The Release workflow triggers automatically when the draft release is published
2. Monitor with `gh run list --workflow=release.yml -L 1` then `gh run watch <run-id>`
3. Verify it succeeded — if it failed, report and stop

### Step 5: PVT — Production Validation Testing (MANDATORY)

**This step is NOT optional. Always run it immediately after the release workflow succeeds. Do NOT ask the user whether to run it — just do it.**

For each variant released, run PVT:

- **Lite**: `/pvt lite`
- **Full**: `/pvt full`
- **Diagramly**: `/pvt diagramly`

Report PVT results to the user.

### Step 5.5: Spot check (targeted coverage for **this** release)

**This step runs automatically after PVT. Do not skip it.**

General workflow, environment selection, and verification methods: **spot-check** skill.

Release-specific: a spot check here is **not** defined as “find a matching `/pvt-*` skill.” It means: **understand what shipped in this iteration** for the variant being released, then **run checks that deliberately exercise those changes** — the smallest set of verification that still covers the delta.

#### 1. Establish the release delta

Find the previous **published** tag for this variant, then list commits between old and new tag:

```bash
gh release list --repo ZenUml/conf-app --exclude-drafts \
  --limit 10 --json tagName \
  | jq -r '[.[] | select(.tagName | test("<variant>"))] | .[1].tagName'
```

```bash
git fetch --tags
git log <prev-tag>..<new-tag> --oneline
```

Read `git log` output **as product intent**, not just keyword soup: group commits into themes (e.g. paywall modal, fullscreen bridge, DrawIO chrome, OpenAPI viewer, editor modal). Note **which user-visible surfaces** and **macro types** are implicated.

For any commit that is not self-explanatory from the subject line, **read the actual diff** (`git show <sha>`) to understand the specific code change before writing the plan.

**Mandatory triage table — required before you may write the plan or declare N/A.**

For every commit in `git log <prev-tag>..<new-tag> --oneline`, assign one of these categories:

| Category | Criteria | Plan action |
|---|---|---|
| `behavioral` | Changes runtime behavior visible to a Confluence user or macro consumer | Must produce at least one `[ ]` assertion in the plan |
| `instrumentation` | Adds/changes analytics events or properties; no UI change | May produce an assertion (event fires + properties) or be skipped with justification |
| `infra/test/docs` | CI config, test files, migration scripts, documentation only | Write `Skipped: <subject> — <reason>` |

A commit categorized as `infra/test/docs` or `instrumentation` that has **any** runtime code change (i.e. touches `src/` or `functions/` outside test directories) must be re-categorized as `behavioral` unless `git show <sha>` confirms the runtime path is never reachable from user-facing flows.

**Variant reachability check (per commit):** A `behavioral` commit may still be unreachable in the variant being released — e.g. the embed macro module is removed from the Diagramly manifest, so `src/forge-embed-editor.ts` changes ship in the Diagramly bundle but cannot be triggered through Diagramly. When this applies, the commit stays `behavioral` but the assertion is replaced with `Not testable in <variant> — <reason, e.g. module removed via manifest yq>`. Don't silently drop it; the entry must appear in the triage table and final report.

You may only write `Spot check: N/A — <justification>` if **every** commit in the triage table is assigned `infra/test/docs` and none is `behavioral` or `instrumentation`. If even one commit is `instrumentation`, write a plan entry for it (even if the assertion is "event fires with correct properties") — the N/A path is closed.

The triage table must appear in your response **before** the plan or any N/A declaration. Output it explicitly — it is a required artifact, not internal reasoning.

#### 2. Write the spot check plan — BEFORE touching the browser

**STOP.** Follow the **spot-check** skill plan format. Release-specific additions below apply on top of that template.

**Format:**

```
Spot check plan for v{new-tag}

Commit: <subject>
  - [ ] <specific observable assertion>  [method]
  - [ ] <specific observable assertion>  [method]

Commit: <subject>
  - [ ] <specific observable assertion>  [method]

Skipped: <subject> — <reason, e.g. "test-only change, no production behaviour">
```

**Example of a good plan entry** (for a commit that adds draft-preview toggle tracking):

```
Commit: Track paywall advocacy draft preview expand and collapse in Mixpanel
  - [ ] Clicking draft toggle (expand) fires Mixpanel `advocacy_draft_preview_clicked`
        with `expanded: true` and `ui_component: "modal"`  [Playwright + request intercept]
  - [ ] Clicking draft toggle (collapse) fires Mixpanel `advocacy_draft_preview_clicked`
        with `expanded: false` and `ui_component: "modal"`  [Playwright + request intercept]
```

**Example of a bad plan entry** (vague; derived from keyword not diff):

```
Commit: Track paywall advocacy draft preview expand and collapse in Mixpanel
  - [ ] Run /pvt-paywall  ← BAD: this is a recipe call, not an assertion
```

**Key rules:**
- Each `[ ]` must be independently pass/fail checkable — if you cannot state what "pass" looks like before running, the assertion is too vague.
- `/pvt-*` skills may appear as **method shortcuts** once an assertion is already written (`/pvt-paywall` covers assertions A, B, C), but never as a substitute for writing the assertion first.
- N/A is only available when **every** commit in the triage table (required in Section 1) is categorized as `infra/test/docs`. If so, write `Spot check: N/A — <one-line justification that references the triage table>` and proceed to Step 6. The triage table must appear in your response before the N/A declaration. A missing triage table means N/A is not available.

#### 3. Execute the plan

Follow the **spot-check** skill execution workflow. Release-specific rules:

- **Variant:** Always pass **the same variant as this release** into skills or instructions (e.g. `/release-app diagramly` → tests target **diagramly**).
- **Pre-built skills:** Invoke `/pvt-*` skills **when they align** with the plan — they are reusable recipes, not the definition of “spot check.”
- **Order:** Run planned checks **sequentially**. Deduplicate redundant steps.
- **Missing skill file:** If you planned to use `/pvt-X` but the skill file does not exist, log `sub-skill /pvt-X not yet implemented`, substitute **manual/custom** steps for that coverage if the delta still requires it — treat missing file as **skipped recipe**, not “no test needed.”

#### 4. Optional keyword hints (secondary)

If helpful when scanning commits quickly, these **hints** often correlate with the listed skills — **do not** treat this table as exhaustive or sufficient on its own:

| Themes (commit / area hints) | Often covered by |
|---|---|
| paywall, upgrade, css, persona, modal | `/pvt-paywall` |
| fullscreen, fullscreen-bridge, viewport, expanded viewer | `/pvt-fullscreen` |
| editor, editor-ui, codemirror, edit path | `/pvt-edit` |
| swagger, openapi | `/pvt-swagger` |
| graph, drawio | `/pvt-drawio` |

#### 5. Collect results for Step 6

Record **pass | fail | skipped** per **planned check** (skill name if used, or short description if custom). If the delta was genuinely tiny (e.g. docs-only), state **“Focused tests: N/A — no product behaviour changed”** with one-line justification — not “no keywords matched.”

### Step 6: Report

Summarize the release:

```
## Release Report: v{version}-{variant}
- Release notes set (replaced placeholder): ✓
- Draft published: ✓
- Release workflow: ✓
- PVT (Mermaid smoke): PASS | FAIL
- Release delta (one line): <themes / surfaces touched>
- Focused tests (targeted coverage for this delta):
  - <check 1 — skill or custom>: PASS | FAIL | SKIPPED — <note>
  - <check 2>: …
  (or: N/A — docs-only / no product behaviour in this tag — <brief justification>)
```

## Error Handling

- **Build workflow fails**: Report which job failed, link to the run, stop
- **Release workflow fails**: Report the failure, link to the run — the draft release was already published so the user may need to investigate manually
- **PVT fails**: Report which variant failed and the error — this is a post-deploy issue that needs immediate attention
- **Focused test fails**: Report **which planned check** failed (skill name or custom step) and **what** was observed — this is a post-deploy issue. Do NOT roll back or block future releases. The app is already live; investigation is the next action.

## Important Notes

- **Never publish with the placeholder body (Step 3).** Auto-created drafts carry a generic `"This is a draft release…"` body. Always replace it with delta-derived release notes via `gh release edit <tag> --notes-file …` before `--draft=false`. The notes reuse the same prev→new delta as the Step 5.5 spot check.
- **Always check for an existing fresh draft first (Step 1).** A merge to main that completed in the last hour or so already produced the drafts you need — reuse them. Pushing a `chore: trigger release pipeline` changelog commit when fresh drafts exist wastes ~15 min of CI, pollutes main history, and gains nothing.
- The build workflow has no `workflow_dispatch` — a push to main is the only fallback if no fresh draft exists
- Draft releases are only created on the `main` branch (not on PRs or other branches)
- All three variants (lite, full, diagramly) are Forge apps deployed to the same production site (`zenuml.atlassian.net`)
- Always confirm with the user before pushing to main or publishing releases
