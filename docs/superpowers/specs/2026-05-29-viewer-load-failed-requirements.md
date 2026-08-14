# Viewer Load-Failed Recovery UI Requirements

## Source Material

This document is derived from the removed implementation preserved on `origin/backup/main-rollback-20260529`, especially:

- `src/components/Viewer/GenericViewer.vue`
- `src/components/Viewer/GenericViewer.spec.ts`
- related commits around generic load-failed state, support diagnostics, retry, and telemetry

This document intentionally does not include JavaScript implementation code.

## Problem

When a published macro cannot load its backing diagram data, the viewer must not appear blank or expose normal diagram actions that cannot work. The user needs a clear state-specific explanation, a safe recovery action, and an easy way to contact support with diagnostic context.

The old branch addressed this with a generic load-failed state in `GenericViewer`. That behavior should be captured as requirements before any reimplementation, because directly copying the old JavaScript may reintroduce lifecycle or slot-gating bugs.

## Goals

1. Show an explicit, understandable load-failed state inside the viewer canvas.
2. Distinguish retryable load failures from unrecoverable missing-data failures.
3. Keep the normal viewer frame and title area available when appropriate.
4. Hide viewer actions that do not make sense without a loaded diagram.
5. Provide a Contact support path that collects useful diagnostics.
6. Provide retry when the failure might be transient or permission-related.
7. Track exposure and support-click events for observability.
8. Avoid renderer-specific DOM timing assumptions.

## Non-Goals

1. Do not reintroduce viewer slot gating that destroys renderer DOM needed by imperative libraries.
2. Do not copy old JavaScript implementation code.
3. Do not change diagram persistence, custom content recovery, orphan recovery, or page editor writeback semantics.
4. Do not make this UI specific to OpenAPI, Graph, Sequence, Mermaid, or PlantUML.
5. Do not expose raw stack traces or sensitive tenant names in visible UI.

## User States

### Retryable / With Content ID

This state applies when the macro has a custom content ID or equivalent source identifier, but the viewer could not load that content.

Likely causes:

- The current user lacks permission to view the backing content.
- The custom content exists but is temporarily unavailable.
- The fetch failed due to a transient network or Atlassian API issue.
- The source content was deleted or restricted.

Required user-facing message:

- Heading: `This diagram isn't available`
- Body: `You may not have permission to view it, or the source content has been removed. Other people on this page might still see it.`

Required actions:

- Primary action: `Try again`
- Secondary action: `Contact support`

Expected behavior:

- `Try again` reloads the current page or otherwise reattempts the full viewer load path.
- `Contact support` collects diagnostics and opens the support portal after giving the user a chance to see the copied-diagnostics toast.

### Unrecoverable / No Content ID

This state applies when the macro has no usable custom content ID or equivalent source identifier and the viewer cannot recover diagram data through fallback logic.

Likely causes:

- The macro configuration is incomplete.
- Legacy data could not be migrated or recovered.
- The original backing data is gone.
- The macro was created or copied into an invalid state.

Required user-facing message:

- Heading: `The diagram data is no longer available`
- Body: `The original diagram data couldn't be recovered. Contact support — or, if you manage this page, remove and recreate this macro.`

Required actions:

- Primary action: `Contact support`
- No retry button is required in this state because there is no known source to refetch.

## Viewer Frame Requirements

1. The load-failed state must render inside the viewer canvas area.
2. The diagram slot/content area must not render at the same time as the load-failed state.
3. The bottom floating action pill must not render in the load-failed state.
4. The title/header area may still render so users can identify which macro failed.
5. Recovered-from-backup banners and read-only chips remain separate from load-failed state and must not be conflated with it.
6. The load-failed UI must work in normal page viewer and fullscreen viewer surfaces.

## Action Requirements

### Try Again

The retry action must:

- Be available only for retryable failures with a source identifier.
- Re-run the whole viewer load path, not only renderer initialization.
- Preserve the current Confluence page context.
- Not mutate diagram data.
- Not create new custom content.

Acceptable implementation choices:

- Full page reload.
- Viewer-level reload if and only if it exercises the same context, custom content, recovery, paywall, and renderer update path as initial load.

### Contact Support

The support action must:

- Be available in both retryable and unrecoverable states.
- Copy a diagnostic payload to the clipboard when possible.
- Show a toast indicating whether diagnostics were copied.
- Open the support portal after a short delay so the toast is visible.
- Track a support-click event.

Required diagnostic fields:

- Short summary: `ZenUML couldn't display a diagram`
- Custom content ID, or `(unknown)`
- Page ID, or `(unknown)`
- Macro UUID/local ID, or `(unknown)`
- Space key, or `(unknown)`
- Client domain, or `(unknown)`
- Module key, or `(unknown)`
- App version and product type, or `(unknown)`
- Forge environment, or `(unknown)`
- Cloud ID, or `(unknown)`
- Direct fetch status, or `(unknown)`
- Load error HTTP status, or `(unknown)`
- Load error code, or `(unknown)`
- Load error class, or `(unknown)`

Support destination:

- `https://zenuml.atlassian.net/servicedesk`

Timing:

- Opening the support portal should be delayed by about 1.5 seconds after copying diagnostics and showing the toast.

## Telemetry Requirements

### Load-Failed Exposure

Emit an event when the generic load-failed state is shown.

Event shape:

- Event name: `load_failed_shown`
- Category/action equivalent: viewer/load-failed exposure
- Label/scope: `load_failed_generic`
- Properties:
  - `state`: `with_id` or `no_id`
  - `content_id`: source identifier as a string, or empty string

The event must fire once per viewer mount that starts in or enters the load-failed state. If the implementation supports state transitions after mount, it must avoid duplicate spam while still tracking meaningful new exposures.

### Support Click

Emit an event when Contact support is clicked.

Event shape:

- Event name: `support_link_clicked`
- Category/action equivalent: click
- Label/scope: `load_failed_generic`
- Properties:
  - `content_id`: source identifier as a string, or empty string

## Accessibility Requirements

1. The load-failed panel must use an alert-like semantic role.
2. Icons must be decorative unless they convey information not present in text.
3. Buttons must have visible text labels.
4. The panel must be keyboard reachable.
5. The support action must not require hover.
6. Text contrast must meet WCAG AA against the white canvas.
7. The bottom action pill must be absent so keyboard focus cannot reach irrelevant actions.

## Visual Requirements

1. Use a quiet, operational UI tone consistent with existing `GenericViewer`.
2. Center the empty state inside the canvas.
3. Use a clear hierarchy: icon, heading, body, actions.
4. Use a neutral icon background.
5. Keep text width constrained for readability.
6. Primary button uses existing viewer primary blue.
7. Secondary button uses white background and neutral border.
8. Buttons must not overlap the bottom floating pill because the pill is hidden in this state.

## Test Requirements

Unit tests must cover:

1. Load-failed state renders when the diagram/load state says content cannot be displayed.
2. Normal diagram slot does not render in load-failed state.
3. Bottom action pill does not render in load-failed state.
4. Retryable state renders `Try again` and `Contact support`.
5. Unrecoverable state renders only the support-oriented primary action.
6. Support link exists for permission-like or missing-data failures.
7. Load-failed exposure telemetry fires with `with_id` and `no_id` states.
8. Contact support copies diagnostics, shows a toast, tracks click telemetry, delays, then opens the support portal.
9. Diagnostic payload includes all required fields.

E2E or spot checks should cover:

1. A published macro with broken custom content shows the retryable load-failed state.
2. A published macro with no recoverable source shows the unrecoverable state.
3. Contact support opens the service desk without breaking the host page.
4. Existing healthy macros still render normally.
5. OpenAPI viewer still renders after async document load and is not broken by load-failed slot behavior.

## Acceptance Criteria

1. Users see a clear, nonblank message when a macro cannot load diagram data.
2. Retryable and unrecoverable cases show different copy and actions.
3. Normal viewer toolbar actions are unavailable in load-failed state.
4. Contact support copies diagnostics and opens the support portal.
5. Telemetry captures exposure and support-click behavior.
6. No renderer loses its required DOM mount point because of this UI.
7. Unit tests pass and cover state, actions, telemetry, and diagnostics.
8. Spot checks confirm healthy OpenAPI, Sequence, Mermaid, PlantUML, and Graph viewers still render.
