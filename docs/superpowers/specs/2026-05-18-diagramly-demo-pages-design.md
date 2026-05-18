# Diagramly Demo Pages — v1 Plumbing Spike Spec

**Date:** 2026-05-18
**Branch:** `feature/diagramly-engagement`
**Status:** Approved for implementation planning
**Revision:** v2 — narrowed after adversarial review (see "Why this is a plumbing spike, not auto-onboarding v1" below).

## Purpose

Validate, end-to-end against a real diagramly site via `forge tunnel`, that we can create a Confluence demo page `asApp` from Diagramly code. That's it. This slice deliberately does NOT ship the auto-onboarding behavior described in `CONTEXT.md`. It is the *first* of several slices toward that goal, and its job is to de-risk the plumbing — Forge function, `asApp` request, custom-content macros rendering inside the created page — before we add the parts that depend on it.

## Why this is a plumbing spike, not auto-onboarding v1

`CONTEXT.md` is explicit: "we explicitly do not fall back to a generic demo, because the proposition is 'we read your content'" and "A bad demo is worse than no demo." Hardcoded content auto-created on install therefore directly contradicts the product thesis. We cannot ship the auto path until the [[Generated demo]] pipeline exists.

`CONTEXT.md` also says the demo page and the onboarding banner are paired — "the page is the artifact, the banner is how anyone finds it." Auto-creating a page without the banner gives us an artifact no non-admin will ever discover.

Conclusion: v1 is **operator-triggered, manual, hardcoded**. An operator (us) clicks a button on a hand-picked dev or pilot tenant to verify the page renders and the Atlassian-side plumbing works. We will not auto-create anything from an install event in this slice.

## Scope of this slice

In scope:

- A single Forge function `createDemoPage` that creates one hardcoded Confluence page in a target space using `asApp`.
- One caller: a Custom UI admin button (Confluence-site-admin gated) that takes a space key and invokes the function.
- A Forge-KV idempotency marker per (installation, spaceKey) so the button is safe to click twice and so deleting the page is treated as opt-out.
- Variant gating to the diagramly build only via CI build-time strip (lite and full builds do not include the function or the button).
- A structured log line per successful create (`{cloudId, spaceKey, pageId, source: 'manual', createdAt}`) emitted to the Forge console — minimum observability without committing to a D1 schema yet.

Out of scope (each is a separate follow-up slice):

- Install/upgrade trigger and any auto-create path. This requires the banner and the AI generation to be in place first (`CONTEXT.md` makes this conditional).
- The onboarding banner (`confluence:pageBanner`). Pair this with the install trigger when both ship together.
- AI-generated, space-tailored content. Until this exists, only operator-approved manual creates are appropriate.
- Space scan / `Suitable space` classifier. No automated decision-making.
- Enrollment allowlist KV. Without an auto path, there is nothing to enroll into.
- Account scan, publication-decision branching, full pipeline state machine.
- Automated backfill of existing tenants. The button covers operator-driven backfill.
- D1 analytics event for "demo page published". Forge-console log is enough until we have a backfill story.

## Domain terminology

This spec uses the terms defined in `CONTEXT.md`: [[Demo page]] (we create one, manually), [[Opt-out signal]] (honored via the storage marker), [[Async onboarding pipeline]] (deferred entirely). [[Suitable space]] and [[Generated demo]] are explicitly NOT implemented here.

## Architecture

```
Forge App (diagramly build only)
│
├─ confluence:globalPage module entry (manifest)
│    key: diagramly-admin-create-demo-page
│    title: "Diagramly Admin — Create demo page"
│    route: zenuml-admin-create-demo-page
│    Visible in the Confluence Apps menu; nominally to all users
│    but the function rejects non-admins server-side.
│    Custom UI page renders the space-key input + "Create demo page" button.
│    → invokes createDemoPageFn via @forge/bridge `invoke` (local resolver,
│      NOT invokeRemote — the function runs inside the Forge runtime, not in
│      a Cloudflare Worker remote).
│
└─ Forge function: createDemoPageFn (declared as a resolver in manifest)
       1. Verify caller is a site admin (see Authorization below). Reject 403 on fail.
       2. Resolve spaceKey → spaceId: asUser GET /wiki/api/v2/spaces?keys=<spaceKey>.
          Require exactly one result with type=global, status=current.
          Reject 404 if missing, 400 if not global/current.
       3. storage.get(`demo-page:<spaceKey>`) → if present, return existing { pageId, createdAt }.
       4. Build hardcoded ADF body (4 macros).
       5. asApp POST /wiki/api/v2/pages with the resolved spaceId.
       6. storage.set(`demo-page:<spaceKey>`, { pageId, createdAt, source: 'manual' }).
       7. Log structured success line.
       8. On any API failure after step 1 but before step 6 succeeds: do NOT write any
          marker; surface the error to the admin UI.
```

The function is the only place where work happens. The button is a thin UI shell that calls it.

**Invocation mechanism — to disambiguate:** the function runs as a Forge resolver inside the Forge runtime, *not* as a remote Cloudflare Worker endpoint. The Custom UI calls it via `@forge/bridge`'s `invoke('createDemoPage', { spaceKey })`, which targets a resolver declared in `manifest.yml`'s `function:` modules. No Cloudflare backend code is added in this slice.

### Components

| Component | Location | Responsibility |
|---|---|---|
| Admin manifest entry | `manifest.yml` `modules.confluence:globalPage` entry `diagramly-admin-create-demo-page` (route `zenuml-admin-create-demo-page`); stripped from lite and full by CI `yq` | Adds an entry to the Confluence Apps menu reachable as `<site>/wiki/apps/<app-id>/zenuml-admin-create-demo-page`. |
| Admin Custom UI page | `src/components/Admin/CreateDemoPage.vue`, wired into `src/forgeIndex.ts` route table | Renders space-key input + "Create demo page" button. On submit, calls `invoke('createDemoPage', { spaceKey })` via `@forge/bridge`. Renders success (pageId + link) or the function's error. |
| `createDemoPage` resolver | `src/forge/createDemoPage.ts`, declared as `function:` module + resolver in `manifest.yml` | The whole flow: admin check, space resolution, idempotency check, ADF build, asApp POST, marker write, structured log. |
| `demoPageContent` | `src/forge/demoPageContent.ts` | Hardcoded ADF body, exported as a constant. Separated so content review is independent of plumbing. |

### Page content

- Title: `Welcome to Diagramly — Try it out`.
- Placement: top-level page in the target space, no parent. Author shown is the Diagramly app (`asApp`).
- Body: H1 welcome + four H2 sections, one per macro type (Sequence, Flowchart, Graph, OpenAPI), each containing the macro with starter content and a one-line tip referencing the Aide byline item. Footer: docs link + a sentence noting the user can delete the page if they don't want it (which anchors opt-out in the page itself).

The ADF JSON lives in `demoPageContent.ts` as a single exported constant.

**Open during implementation:** the Mermaid renderer is reached through the same `zenuml-sequence-macro` key with a Mermaid `bodyType` payload. The exact body shape needs to be verified by hand against a live page before we commit to the constant.

**Macro-rendering gate (enforced via PR checklist, not the spec).** Because "all four macros render" is the actual product validation for this slice, the PR is blocked on a checklist item the reviewer ticks off:

- [ ] Created a demo page on `dia-dev.atlassian.net` via the tunneled admin button.
- [ ] Attached the resulting page URL to the PR description.
- [ ] Attached one screenshot per macro (Sequence, Flowchart/Mermaid, Graph/DrawIO, OpenAPI) showing it rendered, not in an error state.

The checklist is added to the PR template under a "Demo-page validation" section, gated by the file path of this spec. Reviewers reject PRs missing any of the four screenshots.

### Idempotency contract

The Forge KV marker is the single source of truth. The page itself is not consulted.

- Key: `demo-page:<spaceKey>` (per-installation scope, so `cloudId` is implicit in the namespace).
- Value: `{ pageId, createdAt, source }`.
- Rules:
  - Marker present → return existing info. No POST. No-op.
  - Marker absent → POST `/wiki/api/v2/pages`. On 2xx, write marker.
  - Marker absent + POST fails → no marker written; the next click can retry. This is intentional: a transient 429 or 5xx must not become a silent permanent opt-out.
- Opt-out semantics: if the user deletes the page in Confluence, the marker remains, and we will not recreate from the button. Operator can intentionally clear via `forge storage del demo-page:<spaceKey>` to allow recreation. This is consistent with `CONTEXT.md`'s [[Opt-out signal]].

There is no `pending` state. With a single manual caller, the race-condition surface (two callers writing the marker mid-flight) does not exist; building a state machine to guard against it would be YAGNI. Two simultaneous clicks of the button at worst create one duplicate page in a year of operator usage; we accept that and treat duplicate cleanup as a manual operation.

### Variant gating

Diagramly-only. **One layer, deliberately**: CI removes the admin route, the function module, and any related manifest entries from `manifest.yml` for the lite and full builds, using the same `yq` pattern already used to strip `licensing` for lite. No runtime guard — if the manifest doesn't declare the function, Forge cannot invoke it. The `yq` strip is the load-bearing protection; doubling up with a runtime PRODUCT_TYPE check would be belt-and-braces with no real failure mode it actually catches.

If the `yq` strip is later found to be unreliable in practice, we add a runtime guard then — not preemptively.

### Authorization

The `confluence:globalPage` module is technically visible to all signed-in users via the Apps menu, so the server-side check is the only real authorization boundary. We do not rely on UI gating.

**Server-side admin check (load-bearing — implement exactly this):**

1. Get the caller's accountId from the resolver context (`context.accountId` provided by `@forge/resolver`).
2. Call `requestConfluence` `asUser` `GET /wiki/rest/api/user/memberof?accountId={accountId}&start=0&limit=200`. (The v2 user-groups endpoint is still experimental at time of writing; v1 `/wiki/rest/api/user/memberof` is the stable choice.)
3. Inspect `results[].name`. The caller is authorized iff at least one group has `name === 'site-admins'` OR `name === 'confluence-administrators'`.
4. Fail closed on any of: non-2xx response, network error, missing/empty `results` field, no admin group match. Return 403 to the UI with a generic "not authorized" message — do not leak the group names checked.

**Scopes required:** `read:confluence-user` (already in `manifest.yml`).

`createDemoPage` runs `asApp` and can write a page anywhere in the space. The admin check is therefore the only thing standing between an authenticated user and arbitrary `asApp` page creation. If this check is wrong, the slice is unsafe to ship. Treat it accordingly in review.

### Error handling

- On `requestConfluence` failure (4xx, 5xx, network): return `{ ok: false, error: <code + message> }` to the admin UI. No marker is written. The admin can retry.
- On marker-write failure after a successful create: log a Sentry error with the `pageId` so an operator can either reconcile manually or accept that a duplicate may be created on the next click. This is the single remaining failure mode and is acceptable for a manual button used a few times a year.
- The admin UI surfaces failures directly so the operator sees them.

### Permissions

Already in `manifest.yml` scopes:

- `write:page:confluence` — create the page.
- `read:user:confluence` + `read:confluence-user` — check the caller is a site admin.

No new approvals required.

## Testing strategy

The whole point of v1 is the forge-tunnel test. Test plan reflects that.

### Forge-tunnel manual test (the primary test, run before merging)

1. `pnpm forge:tunnel` (diagramly variant) pointing at `dia-dev.atlassian.net`.
2. Log into the dev site as a site admin. Open the admin route.
3. Enter a test space key → click **Create demo page**.
4. Open the created page in Confluence. Verify: title is canonical; four macro placeholders render their content correctly (Sequence, Flowchart via Mermaid, Graph via DrawIO, OpenAPI). This step is the actual product validation — if a macro fails to render, we stop and fix before shipping.
5. Click the button again with the same space key → verify the response shows the existing pageId (idempotent, no duplicate).
6. Delete the page in Confluence → click the button again → verify still no recreate (opt-out honored).
7. Reset via `forge storage del demo-page:<spaceKey>` → click create → verify recreation works.

The test is documented in the spec, the implementation plan reuses the steps, and the PR description references this checklist. We do not automate it in v1.

### Unit tests

Two boundary-level tests in `tests/unit/`:

- `createDemoPage.spec.ts` — given Forge KV stub:
  - **Marker absent**: function POSTs to `/wiki/api/v2/pages` with the expected `spaceId`, title, and a body containing the four expected macro keys; on 2xx, writes the marker with the returned `pageId`.
  - **Marker present**: function does NOT POST; returns the stored marker.
  - **POST fails**: no marker is written; error propagates.
  - **Caller is not site admin**: function rejects before any work.
- `demoPageContent.spec.ts` — the ADF constant parses as valid JSON, has the canonical title, and references the four macro keys declared in `manifest.yml` (typo-safety).

These test what the function *does*, not the order in which it does it.

### What we explicitly do not test in v1

- Install/upgrade trigger path — we are not building it.
- Macro rendering correctness — covered by manual tunnel test step 4, not automated.
- Banner module behavior — out of scope entirely.

## Success criteria

- On a diagramly dev site, a site admin can click the admin button, enter a space key, and see a demo page created in that space within seconds.
- The created page renders all four macros with starter content.
- Re-clicking the button does not duplicate; deleting the page does not recreate it on the next click.
- Lite and full builds (inspect the post-CI `manifest.yml` artifact) contain no reference to the function or admin route.
- Unit tests pass; no regressions.

## Open questions to resolve during implementation

1. The exact Mermaid macro payload — needs hand-verification on a real page before the ADF constant is finalized. Tracked by the macro-rendering PR-checklist gate above.
2. Whether `confluence:globalPage` `route` paths can be CI-stripped cleanly via `yq` (delete by `key`) without leaving dangling `function:` references for lite/full. Confirm by inspecting the post-CI `manifest.yml` artifact for both variants.

## Follow-up slices (sketch only, in suggested order)

1. **Banner + install trigger together** — once the page is the artifact and we have a discoverability surface to pair it with, we can wire the install/upgrade trigger and an enrollment surface (likely Cloudflare KV, to match the team's existing rollout conventions for the paywall and CSS flag). This pair is what `CONTEXT.md` actually describes as the auto-onboarding behavior.
2. **D1 analytics event** for "demo page published" — unlocks the success-metrics funnel.
3. **AI-generated content** — replace `demoPageContent.ts` with the [[Generated demo]] pipeline. This is the precondition for moving from operator-triggered to auto.
4. **Space scan + suitability classifier** — replace operator judgement with an automated [[Suitable space]] decision.
5. **Publication-decision branching** — `publish_both | publish_page_only | banner_only | skip`.
6. **Automated backfill** of existing tenants behind a kill switch.
