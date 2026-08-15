# Byline visibility by app property — Implementation Plan

> **STATUS 2026-08-15: SUPERSEDED IN PART — read this block before executing anything below.**
> The gate SHIPPED the same day on branch `claude/byline-review-design-famy9p` (PR #477), but on
> **space properties**, not the app property this plan prescribes. What actually exists:
>
> - **Condition** (`zenuml-byline-diagrams`, manifest.yml): `and:` of
>   `entityPropertyEqualTo` on space property `zenuml-byline${LITE_KEY_SUFFIX}`
>   (`objectName: enabled`, value `"true"`) and `not: entityPropertyExists` on space property
>   `zenuml-full-active`. The "hide beside Full" clause moved from the writer's decision (this
>   plan's design) into the manifest, at the user's direction. The Full builds normalize the
>   condition (drop the `not` leg) before stripping the module, so a future Full un-strip is safe
>   by construction — see the byline strip in `scripts/forge-wizard.mjs`.
> - **Leg-1 writer**: `src/byline-visibility.ts`, hourly (`byline-visibility-hourly`), sweeps
>   EVERY space via `src/space-properties.ts`. Rollout is a hardcoded **cloudId allowlist**
>   (lite-stg, whimet4) — not the paywall-enrollment Remote endpoint of Phase 2; that seam
>   remains `decide()`. The property key is derived at runtime from the appId and pinned
>   three-way against the manifest template and forge-wizard in
>   `tests/unit/bylineKeyConsistency.spec.ts`. Last-settled-state memory lives in Forge app
>   storage (bounds un-enrolment cleanup to one sweep); the `byline-enabled` app property is
>   fully retired — nothing reads or writes it, and the writer deletes any stored value on its
>   next state transition.
> - **Leg-2 writer**: `src/full-presence.ts`, daily, Full variant only — Full **self-reports**
>   presence per space. The D1 `ForgeInstallation` + TTL inference this plan proposed was
>   dropped for the reasons this plan itself documents (defects 1 and 2 below); no cloudId
>   backfill happened (Phase 1 moot).
> - **Spike answers** (the "required before Phase 4" section), settled in production staging
>   rather than as a spike, at the cost of two broken deploys:
>   - A missing property does hide the item — fail-closed confirmed (byline E2E timed out
>     exactly while no property existed; green after the 08:50Z sweep wrote them).
>   - App-properties PUT: **no** `version.number`, and the endpoint stores the ENTIRE request
>     body as the value — `{key, value}` envelopes double-wrap, and a bare JSON scalar answers
>     **400 on create** (only updates accept scalars, which is why the whimet4 spike missed it).
>   - Space-properties PUT: `version.number` required, next-in-sequence, per docs — enforced in
>     `src/space-properties.fixtures.ts` so specs fail on contract drift.
> - **Analytics**: `byline_visibility_evaluated` / `byline_visibility_write` /
>   `full_presence_write` registered (Phase 0 done, vocabulary adjusted: reason `enrolled`
>   added). Still `console.log`-only — no Forge-function → Mixpanel transport exists yet.
> - **Still live from this plan**: Phase 5 (nudge condition composition — compose with the
>   SPACE property now), Phase 6 (the whimet4 keep-only byline strip still deletes `newuser`),
>   the Phase 3 coverage audit before any production-allowlist widening, and the uninstall-TTL
>   question — which returns as "nothing clears `zenuml-full-active` after a Full uninstall".
>
> The phases below are kept for their evidence tables and constraints, which remain accurate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Control whether the Lite byline entry (`zenuml-byline-diagrams`) renders, per Confluence site, from a Forge **app property** read by a manifest `displayConditions` block. Two outcomes in one mechanism: a per-`cloudId` rollout toggle, and automatic suppression of the Lite byline on sites that also have the Full app installed.

**Architecture:** One boolean app property (`byline-enabled`) per installation. The manifest carries a single positive `entityPropertyEqualTo` condition. The *writer* — a Forge function, because the API is Forge-only — computes `enrolled(cloudId) AND NOT full_present(cloudId)` and PUTs the result. "Hide when Full exists" is therefore a clause in a decision that has to be made anyway, not a second property and not a second condition.

**Tech Stack:** Forge manifest (`displayConditions`), `@forge/api` `asApp()` → Confluence v2 app-properties REST, existing `lite-macro-count-daily` scheduled trigger, Cloudflare D1 (`conf-zenuml-prod`), vitest.

---

## Verified constraints

Everything below was checked rather than assumed; the plan depends on all of it.

| Fact | Evidence |
|---|---|
| `confluence:contentBylineItem` supports `displayConditions` | Atlassian module reference; and in-repo — `zenuml-byline-newuser` already ships `entityPropertyExists` with `entity: content` |
| `entity: app` is a supported Confluence entity type | Forge display-conditions Confluence usage page (`app`, `user`, `content`, `space`) |
| Conditions compose with `and` / `or` / **`not`** | Forge display-conditions reference |
| Display conditions **cannot** reference Forge feature flags | Forge display-conditions reference — this forecloses gating the module with `forge-feature-flag`; the app property is the only runtime-writable input |
| App properties are per app, per installation | Confluence v2 app-properties API — gives per-`cloudId` scoping for free |
| Endpoints: `GET/PUT/DELETE /wiki/api/v2/app/properties/{propertyKey}` | Confluence Cloud v2 app-properties API |
| Scopes already present — no scope change, no major bump | `manifest.yml:87` (`write:app-data:confluence`), `manifest.yml:109` (`read:app-data:confluence`) |
| **The API is Forge-only; the Cloudflare backend cannot write it** | Probed 2026-08-15: `GET /wiki/api/v2/app/properties` with user basic auth → `401 app.property.rest.add_or_delete_on_properties.not_forge_request`, *"Missing OAuth client ID. Was this request sent by a Forge app?"* |
| Lite and Full share one production D1 | Cloudflare Pages API: `conf-lite` and `conf-full` both bind `DB` → `2e34f32e-5ddd-40dc-9e3d-019f9b1d431f` (`conf-zenuml-prod`) |
| Both variants already write installs there | `functions/forge-installed.ts` → `upsertForgeInstallation` |
| ~7 sites currently run both Lite and Full | D1 `ForgeInstallation`, joined on `clientDomain`, 2026-08-15 |

### Two data defects this plan must work around

1. **`cloudId` is NULL on 878 of 983 Lite rows** (the pre-`0009` `backfill` batch). A `cloudId` join therefore returns *zero* overlap while a `clientDomain` join returns 7 — the `cloudId` answer is wrong, not reassuring.
2. **There is no uninstall signal.** `eventType` only ever holds `avi:forge:installed:app` and `backfill`. `avi:forge:upgraded:app` has **never** produced a row, in any of the four apps, despite `remote-installed-trigger` subscribing to it (`manifest.yml:340-344`). Consequences: presence must be inferred with a TTL over `createdAt` (which the upsert does refresh), and **no migration may assume that shipping a release sweeps every install.**

---

## Global constraints

- **Analytics before code.** Events are the first commit (`CLAUDE.md` hard rule).
- **Fail-closed is the accepted cost of the toggle.** Absent property = hidden. Every phase below exists to keep that from reaching users before coverage is proven.
- **The write must reach every Lite install, not just inventory-enrolled ones.** See the early-exit trap in Phase 2.
- **No client names in this repo.** Tenant counts only.
- Deploys go through CI/CD. whimet4 is `workflow_dispatch` on `.github/workflows/deploy-whimet4.yml`.

---

## Phase 0 — Analytics

- [ ] Register `byline_visibility_evaluated` in `src/utils/analytics/catalog.ts` — properties: `decision` (`visible` | `suppressed`), `reason` (`full_present` | `full_absent` | `full_stale` | `not_enrolled` | `no_signal`), `full_last_seen_days`, `evaluation_source` (`install_trigger` | `scheduled`).
- [ ] Register `byline_visibility_write` — properties: `result` (`written` | `cleared` | `unchanged` | `failed`), `failure_reason`.
- [ ] Add the property types to `src/utils/analytics/types.ts`.

Two events, not one: the decision and the write fail independently, and collapsing them makes a failed write read as a deliberate suppression. That ambiguity is precisely what made `ai_aide_route_accessed` unusable as a numerator (see the note in `src/routes/byline.ts`).

## Phase 1 — Prerequisites

- [ ] Backfill `ForgeInstallation.cloudId` from the stored `context` ARI. The regex already exists in `functions/utils/dbUtils.ts:96` — reuse it, do not write a second one.
- [ ] Verify the backfill: distinct `cloudId` per `appId` should approach row count for Lite, and the Lite∩Full overlap computed on `cloudId` should agree with the `clientDomain` figure (7).
- [ ] Choose the presence TTL. Recommendation: 60 days. Document the number and its reasoning next to the query — it is the only thing standing in for the missing uninstall event.

## Phase 2 — The writer (no gating yet)

- [ ] Backend: an authenticated endpoint on the shared Pages project answering, for a `cloudId`, `{ enrolled, full_present, full_last_seen_days }`. Enrollment reuses the paywall's per-tenant enrollment shape rather than a second registry.
- [ ] **Add the path to `public/_routes.json` `include`.** Omitted, Pages serves it as static SPA HTML (200 `text/html`) and the function never runs.
- [ ] Forge writer in `src/macro-count-snapshot.ts`. It already imports exactly what is needed: `api, { getAppContext, invokeRemote, route } from '@forge/api'`.
  - `getAppContext()` → installation identity
  - `invokeRemote` → the decision
  - `GET /wiki/api/v2/app/properties/byline-enabled` → current value
  - unchanged → emit `unchanged` and **skip the PUT** (idempotence bounds both API calls and GB-seconds, and keeps `unchanged` meaningful)
  - changed → `PUT`, emit `written` / `cleared` / `failed`
- [ ] **Place the write BEFORE the unenrolled early-exit.** The function currently "exits after one lightweight Remote claim for unenrolled installations" (`manifest.yml:362-363`). The byline-rollout population and the snapshot-enrollment population are different sets — most Lite tenants are not inventory-enrolled. Behind the early exit, the majority of tenants would never get a property, and under a positive check their byline would stay dark permanently.
- [ ] Also call the writer from `remote-installed-trigger`, so a fresh install does not wait up to 24h. Treat this as an optimisation only: install events do arrive (162 Lite rows), `upgraded` events never have.
- [ ] Unit tests: decision matrix (enrolled × full_present × stale), idempotent skip, failure emits `failed` with a reason.

**Ship Phase 2 with no `displayConditions`.** Nothing is hidden; the writer is being proven.

## Phase 3 — Verify coverage

- [ ] Wait one full daily cycle after Phase 2 reaches production.
- [ ] Compare distinct `cloudId` with a successful `byline_visibility_write` against known live Lite installs (`forge install list` is authoritative; the D1 mirror is a mirror).
- [ ] Confirm the ~7 both-installed tenants resolved to `suppressed` and everyone else to `visible`.
- [ ] Do not proceed while any live install lacks a property.

## Phase 4 — Gate

- [ ] Add to `zenuml-byline-diagrams`:
  ```yaml
  displayConditions:
    entityPropertyEqualTo:
      entity: app
      propertyKey: byline-enabled
      value: true
  ```
- [ ] Confirm the deployed version is **minor** from the `forge deploy` output (expected: no scope, dynamic web trigger, or licensing/remotes change). Per `CLAUDE.md`, the deploy output is the authority, not this document.

## Phase 5 — The nudge entry

`zenuml-byline-newuser` ships in Lite, Full **and** Diagramly, all titled `View as diagram` with no `${LITE_TITLE_SUFFIX}`, all keyed on the same content property in Confluence's **global** property namespace. On a both-installed site, either app writing `zenuml-prepared-diagram` satisfies *both* apps' conditions — two identical items, today, independent of anything in this plan.

- [ ] Add `${LITE_TITLE_SUFFIX}` to its title.
- [ ] Compose both conditions:
  ```yaml
  displayConditions:
    and:
      entityPropertyExists:
        entity: content
        propertyKey: zenuml-prepared-diagram
      entityPropertyEqualTo:
        entity: app
        propertyKey: byline-enabled
        value: true
  ```

## Phase 6 — Housekeeping

- [ ] Realign the whimet4 byline strip. It uses `select(.key != "zenuml-byline-diagrams")`, a keep-only-one rule that also deletes `newuser`; real Lite only drops `aiaide`. Its own comment claims to be in sync with `staging-deploy.yml` and is not — so the activation nudge cannot currently be validated on whimet4.

---

## Spike — required before Phase 4

Run on whimet4 (`yanhui` env, Lite app). None of this can be probed with curl: the app-properties API rejects non-Forge callers outright (see the 401 above), so the spike needs deployed Forge code.

- [ ] **Does `entity: app` actually gate a `contentBylineItem`?** The in-repo precedent proves the module type accepts `displayConditions`, but with `entity: content`.
- [ ] **How does a *missing* property evaluate?** Under a positive check an absent property must hide the item. Confirm rather than assume — the whole fail-closed migration story depends on it.
- [ ] **PUT update semantics.** Confluence property APIs generally require `version.number` on update and reject a bare overwrite with 409. The app-properties docs mention only "an object containing the property value". Test the **second** write, not just the first: a create-succeeds/update-409s pattern looks healthy on a fresh tenant and fails on every subsequent flip.
- [ ] UI evidence required — a Playwright screenshot or snapshot of the byline region in both states. A passing unit test does not satisfy a UI assertion (`CLAUDE.md` hard rule).

---

## Risks

| Risk | Mitigation |
|---|---|
| Fail-closed: a silent write failure makes a tenant's byline vanish | Phases 2→4 split; `byline_visibility_write` `failed` must be alerted on, not just recorded |
| A dark tenant is indistinguishable from an unenrolled one | The two-event split is what separates them; do not merge them later |
| Suppression persists after Full is uninstalled | Daily re-evaluation plus the presence TTL; blast radius is the ~7 both-installed sites, not all 105 |
| Daily writer depends on the backend | Fails safe — a missed run leaves the previous decision in place. A *wrong* decision persists until the next successful run, which is why the TTL value matters more than it appears |
| `cloudId` join silently wrong | Phase 1 backfill is a hard prerequisite, not an optimisation |
