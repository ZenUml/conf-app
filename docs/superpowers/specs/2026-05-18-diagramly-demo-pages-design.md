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
├─ Custom UI admin route — /admin/create-demo-page
│    Gated: Confluence site admin only.
│    UI: space-key input + "Create demo page" button.
│    → invokes createDemoPageFn via @forge/bridge invokeRemote
│
└─ Forge function: createDemoPageFn
       1. storage.get(`demo-page:<spaceKey>`) → if present, return existing { pageId, createdAt }
       2. Build hardcoded ADF body (4 macros)
       3. requestConfluence asApp POST /wiki/api/v2/pages
       4. storage.set(`demo-page:<spaceKey>`, { pageId, createdAt, source: 'manual' })
       5. Log structured success line
       6. On API failure: do NOT write any marker; surface error to the admin UI
```

The function is the only place where work happens. The button is a thin UI shell that calls it.

### Components

| Component | Location | Responsibility |
|---|---|---|
| Admin route | `src/components/Admin/CreateDemoPage.vue` (or smallest matching existing pattern) | Site-admin-gated input + button. Calls `createDemoPageFn`. Renders success (with pageId / link) or error. |
| `createDemoPageFn` | `src/forge/createDemoPage.ts` | The whole flow: idempotency check, page build, asApp POST, marker write, log. |
| `demoPageContent` | `src/forge/demoPageContent.ts` | Hardcoded ADF body, exported as a constant. Separated so content review is independent of plumbing. |

### Page content

- Title: `Welcome to Diagramly — Try it out`.
- Placement: top-level page in the target space, no parent. Author shown is the Diagramly app (`asApp`).
- Body: H1 welcome + four H2 sections, one per macro type (Sequence, Flowchart, Graph, OpenAPI), each containing the macro with starter content and a one-line tip referencing the Aide byline item. Footer: docs link + a sentence noting the user can delete the page if they don't want it (which anchors opt-out in the page itself).

The ADF JSON lives in `demoPageContent.ts` as a single exported constant.

**Open during implementation:** the Mermaid renderer is reached through the same `zenuml-sequence-macro` key with a Mermaid `bodyType` payload. The exact body shape needs to be verified by hand against a live page before we commit to the constant. This is a hard precondition — we don't ship the button until all four macros render correctly on a manually-created tunnel page.

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

The admin route is only visible to Confluence **site admins**. The function additionally checks the caller's site-admin status server-side before doing anything (defense in depth — a hidden UI route alone is not an authorization model). Implementation: use `requestConfluence` with the user token to fetch the current user's site permissions; reject with 403 if not site admin.

This matters: `createDemoPage` runs `asApp` and can write a page anywhere in the space. We cannot let an arbitrary authenticated user trigger it.

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

1. The exact Mermaid macro payload — needs hand-verification on a real page before the ADF constant is finalized.
2. Which existing admin surface to mount the button on. Smallest footprint wins; if no surface fits cleanly, add a new minimal one.
3. Exact site-admin check API — there are a few candidates in the Confluence REST API; pick whichever returns a clean boolean.

## Follow-up slices (sketch only, in suggested order)

1. **Banner + install trigger together** — once the page is the artifact and we have a discoverability surface to pair it with, we can wire the install/upgrade trigger and an enrollment surface (likely Cloudflare KV, to match the team's existing rollout conventions for the paywall and CSS flag). This pair is what `CONTEXT.md` actually describes as the auto-onboarding behavior.
2. **D1 analytics event** for "demo page published" — unlocks the success-metrics funnel.
3. **AI-generated content** — replace `demoPageContent.ts` with the [[Generated demo]] pipeline. This is the precondition for moving from operator-triggered to auto.
4. **Space scan + suitability classifier** — replace operator judgement with an automated [[Suitable space]] decision.
5. **Publication-decision branching** — `publish_both | publish_page_only | banner_only | skip`.
6. **Automated backfill** of existing tenants behind a kill switch.
