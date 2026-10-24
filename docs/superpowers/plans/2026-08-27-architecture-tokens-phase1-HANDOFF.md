# Architecture Tokens Phase 1 — implementation handoff

Read this first. It tells an implementing agent what to build, what already exists, what must never happen, and which documents carry the details. Everything here was decided with the product owner on 2026-08-27; do not re-open the decisions — build them.

## 0. The job in one paragraph

A reader of a **Mermaid `sequenceDiagram`** macro in Confluence (Lite variant, one pilot tenant, behind a Forge feature flag) sees, after the diagram renders, a quiet footer line — *"5 of 7 participants also appear in other diagrams you can access · as of 27 Aug"*. Moving the pointer over a lifeline reveals a small count pill; clicking the pill opens a popover listing the pages (title, space, and the label variant used there) where a participant with the same lexical key appears. The index behind it is built **locally** from the D1 mirror and uploaded to one D1 table; one authenticated Cloudflare Pages route joins by key and filters pages **as the requesting user**. No Forge function, no manifest change, no admin consent.

## 1. Documents, in reading order

| # | document | what it settles |
|---|---|---|
| 1 | this file | scope, state of the world, rules, how to run |
| 2 | `docs/superpowers/specs/2026-08-27-architecture-tokens-phase1-design.md` | the product/data/backend/gate/analytics design — every decision with its reason |
| 3 | `docs/superpowers/specs/2026-08-27-architecture-tokens-phase1-frontend-design.md` | the viewer UI: states, anatomy, exact CSS values, copy, behaviour rules, fixture |
| 4 | design canvas https://claude.ai/code/artifact/57b5165b-854a-4c29-92c8-57b0a6e734bd and `docs/design/architecture-tokens-phase1/preview/*.png` | what it must look like (five states) |
| 5 | `docs/superpowers/plans/2026-08-27-architecture-tokens-phase1.md` | the step-by-step plan: 10 tasks, TDD, code included |
| 6 | `tools/architecture-tokens/README.md` | the local pipeline that already exists (extractor, normalizer, corpus reader) |
| 7 | `docs/policies/client-privacy.md` | why customer data never enters a repository |

The original product brief (three layers: raw label → lexical key → canonical Token ID; "possible related" vs "confirmed") is folded into doc 2 §2; Phase 1 implements only the first two layers and the viewer surface.

## 2. State of the world (verified 2026-08-27)

**Branch / worktree.** `feat/architecture-tokens-local-pilot`, checked out at `/Users/pengxiao/workspaces/zenuml/conf-app-architecture-tokens` (a git worktree of `conf-app`; base `origin/main` at `7b38a730`). Work there, or create your own worktree from that branch. The main checkout `/Users/pengxiao/workspaces/zenuml/conf-app` carries another session's uncommitted changes — never run `git checkout/reset/stash/clean` in it.

**Already on the branch (tested, lint-clean):**
- `tools/architecture-tokens/extract.ts` + `extract.spec.ts` — participant extractor; 13 tests incl. parity against mermaid's own `getActors()`; 540/540 declarations on the pilot corpus, 0 mismatches.
- `tools/architecture-tokens/pilot/participant-normalization.mjs` + spec — the lexical key (`@sindresorhus/slugify` 3.0.0, `separator: '.'`, `decamelize`, `transliterate: false`, emoji stripped; diacritics kept).
- `tools/architecture-tokens/read-corpus.mjs` (single-space mode; Task 3 adds tenant-wide), `extract-corpus.mjs` (corpus → occurrence artifact), `pilot/*` (browser builder, model-overlay scorers; optional).
- `eslint.config.mjs` block giving `tools/architecture-tokens/**/*.mjs` the `process` global.
- Docs 2, 3, 5 and the design sources.

**Forge feature flag** `architecture-tokens-enabled` exists on the Lite app (`8ad26115-211f-4216-971b-0540f606303d`), ID type `installContext`: rule 1 `everyone` → development + staging; rule 2 `installContext is any of [pilot site ARI]` → production only, 100%; default `false`. Read it with `client.checkFlag('architecture-tokens-enabled', false)` through the existing client in `src/apis/aiTitleFeatureFlag.ts`. Lite has 8/10 flag slots used.

**D1 (`conf-zenuml-prod`).** `CustomContent` rows hold the wrapped Confluence body: `json_extract(body, '$.raw.value')` is the diagram JSON string with `diagramType` and `mermaidCode`; `pageId` and `spaceId` are populated. The tenant's `cloudId` is in `AtlassianInstance` where `clientDomain = '<domain>.atlassian.net'` (the `ForgeInstallation` row for the bare domain has `cloudId NULL`). Tenant spaces come from `DiagramAudience(cloudId → customContentId) → CustomContent.spaceId` (36 spaces for the pilot; a lower bound). The new table `ArchitectureTokenOccurrence` does **not exist yet** — Task 2 adds migration `0021`; CI applies migrations on staging deploy and on release (`.github/actions/wrangler-publish/action.yml`, *Run D1 Migrations*). An earlier `0021` (LLM-calibration tables) was applied to prod by mistake and has been dropped; the number is free.

**Working `wrangler` form** (verified): `npx wrangler d1 execute conf-zenuml-prod --remote --json --command "<sql>"` from the repo root. `--config wrangler-prod.toml --env production` also works from CI; do not use `--env production` with the default `wrangler.toml` locally (it fails with a 7403).

**Local customer data** lives in `$ARCHTOK_DIR` = `private/local-data/architecture-tokens/<pilot>/` (git-ignored via `private/.gitignore` `local-data/`): `cloud-id`, `space-id`, `app-id`, `raw/` (corpora), `participant-occurrences*.json`, `model-runs/`, the HTML browser. Read the ids from those files; never print them into chat, docs, commits, or tests.

**Superseded, do not use:** branches `codex/architecture-tokens-mvp0` (LLM-in-Worker pipeline) and `feat/architecture-token-source-binding` (flowchart binding), plus `docs/superpowers/specs/2026-08-27-sequence-token-preprocessing-mvp0-design.md`. They are kept until this branch merges, then deleted.

## 3. Rules that override anything else

1. **Customer content never enters any repository** — corpus, labels, model outputs, tenant/cloud/space ids, page titles. The `private/` submodule included. Fixtures are invented (see doc 3 §6). The public repo says *the pilot tenant*.
2. **No Forge function, no scheduled trigger, no `manifest.yml` change.** Backend = one Cloudflare Pages Function under `functions/api/architecture-tokens/`, registered in `public/_routes.json` **and** in `AUTHENTICATED_PATHS` (`functions/_middleware.ts`).
3. **The render never waits.** Lookup after `viewerLoadState === 'ready'`; all failures silent to the user; every failure recorded as `related_diagrams_lookup_failed`.
4. **Nothing about an inaccessible page reaches the browser.** The route runs one CQL `id in (…)` **as the requesting user** (`x-forge-oauth-user` bearer, the pattern in `functions/utils/confluenceUtils.ts`) and returns only what that call returned.
5. **Progressive reveal.** Diagram untouched by default → hover reveals one count pill → click opens the popover. Hover never opens anything.
6. **Cautious copy only** (doc 3 §4). No "confirmed", no "same as".
7. **Analytics first.** Task 1 lands the five events before any feature code (project rule). No label text or ids in events.
8. **TDD, one-line commit subjects, `Co-Authored-By` + `Claude-Session` trailers, never `--no-verify`, never delete or skip a test to go green.** Commit after every task.
9. **Never commit directly to `main`.** The plan ends in a PR via `/submit-branch`; production release only when the owner says so.

## 4. How to run things

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app-architecture-tokens
pnpm install --frozen-lockfile                      # if node_modules is missing
pnpm vitest --run tools/architecture-tokens          # 19 tests today
pnpm exec eslint tools/architecture-tokens
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep '<your new path>'   # baseline has ~150 pre-existing errors; only new-file errors count
node --experimental-strip-types tools/architecture-tokens/extract-corpus.mjs --corpus $ARCHTOK_DIR/raw/<corpus>.json --out $ARCHTOK_DIR/participant-occurrences.json
```
Notes: `node --experimental-strip-types` is how `.mjs` scripts import `extract.ts` (no `tsx` in the repo); the "Reparsing as ES module" warning is benign. Vitest runs under jsdom with `tests/test-setup.ts`; specs are co-located (`*.spec.ts` next to source; `**/tmp/**` is excluded). Mermaid under jsdom needs `Option`/`HTMLElement` globals (vitest's jsdom provides them); a `create participant` in a fixture must be followed by a message to it or mermaid throws.

## 5. Execution protocol

1. Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` on doc 5, task by task, in order 1 → 10. Each task ends green, linted, committed.
2. After Task 4 the pipeline can run end to end against the **local** D1 (`pnpm run db:migrate:local` first); the production upload waits for migration 0021 to reach prod (CI on release).
3. Task 10 is the proof: on **lite-dev** (flag rule 1 covers development), a page with two sequence diagrams sharing a participant label; screenshots of (a) the clean diagram, (b) hover → pill, (c) click → popover; the five Mixpanel `/track/` events captured from the macro iframe. Use the `forge-tunnel` skill with `--profile "Profile 8"` (the robot account cannot see tunnel code). Save evidence under `$ARCHTOK_DIR/verification/`.
4. Open the PR with `/submit-branch`; title `feat(viewer): "also appears in other diagrams" context for Mermaid sequence participants — pilot tenant, flag-gated`; body states: no manifest change, no Forge function, flag default false, production rule targets one site, migration 0021 applied by CI.
5. Release and the production upload happen only on the owner's explicit go; post-release evidence is Mixpanel `related_diagrams_lookup_succeeded` with the released `app_version` and the pilot tenant's `client_domain` (no account of ours can open the pilot site).

## 6. Acceptance checklist

- [ ] Five events in `catalog.ts`/`types.ts`, `feature_area: 'architecture_tokens'`
- [ ] Migration `0021_add_architecture_token_occurrence.sql` with the composite PK and two indexes
- [ ] `read-corpus.mjs --client-domain` resolves the tenant via `AtlassianInstance` + `DiagramAudience`; `upload-index.mjs` replaces per tenant per run in one transaction
- [ ] Route `GET /api/architecture-tokens/related?customContentId=` — 401 without Forge context, 400 on a bad id, 405 on POST, always 200 for lookup failures with `error_kind`; permission filter runs as the user; self excluded
- [ ] `RelatedDiagramsFooter.vue`: footer copy exact; pills hidden until hover/focus/open; click-only popover; Escape/outside close; dropped renamed participants; `openUrl` for links; all five events with the listed properties
- [ ] Mounted in `GenericViewer.vue` only for Mermaid `sequenceDiagram` with the flag on; `surface` = `'fullscreen'` in the modal
- [ ] No customer string anywhere in the diff (`grep -rEi '<pilot-domain>|[0-9a-f]{8}-[0-9a-f]{4}-' <changed files>` empty)
- [ ] lite-dev evidence saved; PR open; CI green
