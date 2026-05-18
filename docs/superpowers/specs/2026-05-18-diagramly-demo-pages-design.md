# Diagramly Demo Pages — Design Spec

**Date:** 2026-05-18
**Branch:** `feature/diagramly-engagement`
**Status:** Approved for implementation planning

## Purpose

Ship the first vertical slice of the Diagramly auto-onboarding work described in `CONTEXT.md`: an automatically created Confluence page that introduces Diagramly to a tenant's space, containing pre-built try-it-now macros. The goal is to validate the create-page-`asApp` plumbing end-to-end against a real diagramly site via `forge tunnel` before adding any of the more expensive pieces (AI generation, suitability classifier, banner, publication-decision branching).

## Scope of this slice

In scope:

- A Forge function that creates a single hardcoded demo page in a target Confluence space, using `asApp` credentials.
- Two callers for that function:
  1. An install/upgrade trigger that fires on `avi:forge:installed:app` and `avi:forge:upgraded:app`, gated by a per-(cloudId, spaceKey) allowlist in Forge KV.
  2. A manual admin button (Custom UI) that bypasses the allowlist — used for forge-tunnel testing and operator-driven backfill on existing tenants.
- Forge-KV idempotency marker per (installation, spaceKey) so re-installs and re-clicks do not duplicate, and so deleting the page in Confluence is treated as opt-out.
- Variant gating to the diagramly build only (lite and full builds do not ship this module).

Out of scope (these are deliberate cuts against CONTEXT.md; each is a follow-up slice):

- AI-generated, space-tailored content (`Generated demo` term in `CONTEXT.md`). This slice uses static content only.
- Space scan / `Suitable space` classifier. The KV allowlist is the only gate.
- Account scan and publication-decision branching (4 outcomes). This slice only implements the `publish_page_only` equivalent.
- The onboarding banner (`confluence:pageBanner` module).
- A structured D1 analytics event for "demo page published". This slice logs to Sentry / Forge console only.
- Automated backfill of the existing ~13 diagramly tenants. The admin button supports operator-driven backfill, one tenant at a time.

## Domain terminology

This spec uses the terms defined in `CONTEXT.md`: [[Demo page]], [[Suitable space]] (referenced only to say we're skipping it), [[Async onboarding pipeline]] (this slice is the bare minimum of phase 2 without the per-space loop), [[Opt-out signal]] (honored via the persistent storage marker).

## Architecture

```
Forge App (diagramly variant only)
│
├─ Trigger module: demoPageInstallTrigger
│    events: avi:forge:installed:app, avi:forge:upgraded:app
│    → invokes demoPageTriggerFn
│
├─ Custom UI admin button (dev/admin route)
│    → invokes demoPageManualFn via @forge/bridge
│
└─ Shared core: createDemoPage({ cloudId, spaceKey, source })
       1. PRODUCT_TYPE !== 'diagramly' → no-op
       2. storage.get(`demo-page:<spaceKey>`) → if present, no-op
       3. storage.set(`demo-page:<spaceKey>`, { status: 'pending' })
       4. Build hardcoded ADF body (4 macros)
       5. requestConfluence asApp POST /wiki/api/v2/pages
       6. storage.set(`demo-page:<spaceKey>`, { pageId, createdAt, source })
       7. On failure: Sentry-log; leave pending marker so we don't double-create
```

`createDemoPage` is the single code path that performs the work. Both callers reduce to "decide whether to call it, and with which spaceKey".

### Components

| Component | Location | Responsibility |
|---|---|---|
| `demoPageInstallTrigger` | `manifest.yml` (module) | Forge trigger module wiring install/upgrade events to the trigger function. |
| `demoPageTriggerFn` | `src/forge/demoPageTrigger.ts` (Forge function) | Loop over enrolled (spaceKey) entries from Forge KV for this installation. For each, call `createDemoPage` with `source: 'install'`. |
| `demoPageManualFn` | `src/forge/demoPageManual.ts` (Forge function, invoked from Custom UI) | Take a spaceKey argument from the admin button. Bypass the allowlist. Call `createDemoPage` with `source: 'manual'`. |
| `createDemoPage` | `src/forge/createDemoPage.ts` | Shared core. Idempotency, gating, page creation. |
| `demoPageContent` | `src/forge/demoPageContent.ts` | The hardcoded ADF body (kept separate so reviewing/testing the content does not pull in the function plumbing). |
| Admin button UI | `src/components/Admin/CreateDemoPage.vue` (or similar) | A Custom UI button + space-key input. Hidden behind an admin route; not visible to end users. |

### Data flow

**Install path:**

```
Atlassian fires avi:forge:installed:app
  → Forge invokes demoPageTriggerFn (asApp)
    → for each Forge-KV key matching `demo-page-enroll:*`:
        spaceKey ← key suffix
        createDemoPage({ cloudId, spaceKey, source: 'install' })
```

**Manual path:**

```
Admin opens admin route in Confluence
  → Clicks "Create demo page", supplies spaceKey
    → @forge/bridge invokeRemote → demoPageManualFn
      → createDemoPage({ cloudId, spaceKey, source: 'manual' })
```

### Page content

- Title: `Welcome to Diagramly — Try it out` (canonical; same across all tenants).
- Placement: top-level page in the target space, no parent. Author shown is the Diagramly app (because we create `asApp`).
- Body structure:
  1. H1 "Welcome 👋" + one paragraph introducing Diagramly.
  2. Four sections — one per macro type — each containing:
     - H2 heading naming the diagram type (Sequence, Flowchart, Graph, OpenAPI).
     - One-line intro.
     - The macro itself (`zenuml-sequence-macro`, Mermaid-via-sequence-macro, `zenuml-graph-macro`, `zenuml-openapi-macro`) with starter content.
     - A tip line referencing the Aide byline item.
  3. Footer: documentation link + "Delete this page if you'd rather not see it" — anchors the opt-out behavior in the content the user actually sees.

The ADF JSON lives in `demoPageContent.ts` as a single exported constant. We can unit-test that it is valid JSON, that the four macro keys match `manifest.yml`, and that the title is the canonical string.

### Idempotency contract

The Forge KV marker is the single source of truth. The page itself is not consulted.

- Key: `demo-page:<spaceKey>` (per-installation scope, so `cloudId` is implicit).
- Values:
  - `{ status: 'pending' }` — set before the create call. Blocks retries even if the create fails mid-flight.
  - `{ pageId, createdAt, source }` — set on success.
- Rules:
  - Marker present (any value) → `createDemoPage` returns without doing anything.
  - Marker absent → write `pending`, attempt create, finalize.
- Opt-out semantics: if the user deletes the page in Confluence, the marker remains. We will not recreate. This is the [[Opt-out signal]] from `CONTEXT.md`.
- Recovery: an operator can `forge storage del demo-page:<spaceKey>` to allow recreation (or use a hidden "Reset" affordance on the admin page — TBD whether this ships in v1).

### KV semantics

Two Forge-KV key spaces, both per-installation:

| Key | Purpose | Written by | Read by |
|---|---|---|---|
| `demo-page:<spaceKey>` | Idempotency marker | `createDemoPage` | `createDemoPage` |
| `demo-page-enroll:<spaceKey>` | Allowlist (only for the install/upgrade trigger path) | Operator runs `forge storage set demo-page-enroll:<spaceKey> enrolled` per enrolled space in v1 (an admin REST endpoint is a follow-up) | `demoPageTriggerFn` |

Value of `demo-page-enroll:<spaceKey>` is `'enrolled'` in v1. We can extend to `{ enrolledAt, enrolledBy, notes }` later without changing the read path (treat any truthy value as enrolled).

The manual path does not read the enrollment KV — by design, so it stays useful for development and operator backfill without polluting the enrollment list.

### Variant gating

Diagramly-only. Two layers:

1. **Runtime guard** at the entry of `createDemoPage`: read the Forge env variable `PRODUCT_TYPE` (declared in `manifest.yml` `environment.variables`, default `lite`; CI sets it per variant build). If `!== 'diagramly'`, return early. Defense-in-depth in case the manifest module accidentally ships in a non-diagramly build.
2. **Build-time strip**: CI removes the trigger module, the manual function module, and the admin route from `manifest.yml` for the lite and full builds using `yq` (same pattern used today to strip `licensing` for lite, and to strip Connect-only modules per variant).

### Error handling

- `createDemoPage` failures are caught and logged via Sentry (`captureError`) plus the Forge console. The pending marker is left in place to prevent duplicate-create on retry.
- The trigger function iterates over enrolled spaces with `for...of` and a try/catch per space, so one failing space does not block the others.
- Confluence API errors (403, 404 space, rate limit) are logged with `cloudId` and `spaceKey` for diagnosability.

### Permissions

Already in `manifest.yml` scopes (no new approvals needed):

- `write:page:confluence` — create the page.
- `read:space:confluence` — verify the space exists before creating (optional but recommended).
- `read:app-system-token` — receive the `asApp` token at the trigger endpoint.

## Testing strategy

### Forge-tunnel inner loop (manual path)

The primary inner loop. Fast feedback.

1. `pnpm forge:tunnel` (diagramly variant) pointing at a diagramly dev site (e.g. `dia-dev.atlassian.net`).
2. Open the admin route in the dev site → enter a test space key → click **Create demo page**.
3. Verify the page appears in that space with the canonical title and four rendered macros.
4. Click the button again → verify no duplicate page is created (marker check).
5. Delete the page in Confluence → click the button again → verify still no recreate (opt-out honored).
6. Reset via `forge storage del demo-page:<spaceKey>` → click create → verify recreation works.

### Forge-tunnel install path

The full integration check, run before merging.

1. With the tunnel running, set Forge KV: `forge storage set demo-page-enroll:<spaceKeyA> enrolled` for one space; leave a second space `<spaceKeyB>` un-enrolled.
2. Bump the app version and reinstall the diagramly app on the dev site (this re-fires `avi:forge:installed:app`).
3. Verify `<spaceKeyA>` gets a demo page; `<spaceKeyB>` does not.
4. Reinstall again → verify no duplicate in `<spaceKeyA>` (marker still terminal).

### Unit tests

In `tests/unit/`:

- `demoPageContent.spec.ts` — ADF is valid JSON, contains the canonical title, references the four macro keys defined in `manifest.yml`.
- `createDemoPage.spec.ts` — mocks the Forge KV + `requestConfluence`. Asserts: variant guard short-circuits, marker-present short-circuits, marker is written `pending → finalized`, failure leaves `pending` marker.
- `demoPageTrigger.spec.ts` — iterates enrolled keys, calls `createDemoPage` for each, handles per-space failures without stopping the loop.

### What we explicitly do not test in v1

- The hardcoded ADF actually rendering correctly on Confluence — covered by manual tunnel test, not automated.
- Banner display, AI-generated content, suitability classifier — out of scope.

## Success criteria

- A diagramly dev site, with one space enrolled in `demo-page-enroll`, gets exactly one demo page on (re)install.
- The page contains four rendered macros (Sequence, Flowchart, Graph, OpenAPI) with starter content.
- Re-install does not duplicate; deletion is not recreated.
- Lite and full builds ship without the trigger or the function — confirmed by inspecting their built `manifest.yml`.
- Unit tests pass; no regressions in existing tests.

## Open questions to resolve during implementation

1. Exact admin route — does it live under an existing admin surface (e.g., `/admin/metrics-inspect`) or a new one? Pick the smallest possible footprint.
2. Whether to ship a "Reset" affordance in v1 or rely on `forge storage del` from the CLI. Lean toward CLI-only in v1.
3. Mermaid macro key — the Mermaid renderer goes through the same `zenuml-sequence-macro`, so the demo body needs the right `bodyType` payload to render as a flowchart. Confirm during implementation.
4. Whether `demo-page-enroll:*` can hold non-`spaceKey` keys we'd want to ignore (defensive parsing).

## Follow-up slices (sketch only)

These are the next bites against `CONTEXT.md`, in roughly the order they unblock value:

1. **Banner module** — pair the page with the discoverability surface that gets non-admin readers to it.
2. **D1 analytics event** for "demo page published" — unlock the success-metrics funnel described in `CONTEXT.md`.
3. **Space scan + suitability classifier** — replace the manual `demo-page-enroll` allowlist with an automated decision.
4. **AI-generated content** — replace `demoPageContent.ts` with the [[Generated demo]] pipeline.
5. **Publication decision** — branch on `publish_both | publish_page_only | banner_only | skip`.
6. **Automated backfill** of the existing 13 tenants, gated behind a kill switch.
