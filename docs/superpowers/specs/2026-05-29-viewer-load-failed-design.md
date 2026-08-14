# Viewer Load-Failed Recovery UI Design

## Source Material

This design is based on behavior preserved on `origin/backup/main-rollback-20260529`. It intentionally avoids JavaScript code because the old implementation should not be copied directly. CSS is included because the visual treatment is useful and low risk.

## Design Summary

Add a generic load-failed recovery panel to the viewer canvas. The panel appears when the viewer knows that no diagram can be rendered. It replaces the diagram slot and hides the bottom floating action pill.

The design has two states:

- **Retryable state**: there is a source identifier, but the viewer could not load it. Show `Try again` and `Contact support`.
- **Unrecoverable state**: there is no usable source identifier and fallback recovery failed. Show `Contact support` as the primary action.

The implementation should be state-driven and must not rely on hiding or destroying renderer DOM during initial async load. A viewer should only enter this load-failed state after the load process has resolved to failure.

## State Model

The viewer shell needs enough state to answer these questions:

1. Is the viewer still loading?
2. Did loading finish successfully?
3. Did loading fail?
4. Is there a source identifier that makes retry meaningful?
5. Is there load-error metadata for diagnostics?

Recommended conceptual states:

- `loading`: document/content lookup has not settled.
- `ready`: document loaded and a renderer can display content.
- `failed_with_source`: load failed but the macro has a custom content ID or equivalent source identifier.
- `failed_without_source`: load failed and there is no recoverable source identifier.

Do not infer permanent load failure from `NULL_DIAGRAM` alone during first mount. `NULL_DIAGRAM` can be a placeholder while async document loading is still in progress.

## Component Boundary

### Generic Viewer

`GenericViewer` owns:

- Viewer chrome.
- Load-failed presentation.
- Retry action surface.
- Support action surface.
- Hiding irrelevant viewer toolbar actions in load-failed state.
- Accessibility roles and layout.

`GenericViewer` must not own:

- Renderer-specific initialization.
- Swagger, DrawIO, Mermaid, PlantUML, or ZenUML renderer lifecycle.
- Custom content fetching.
- Orphan recovery.
- Macro persistence repair.

### Viewer Entry Points

Entry points own:

- Forge context initialization.
- Custom content lookup.
- Orphan or legacy recovery.
- Publishing load result into shared viewer state.
- Post-load side effects such as attachment generation.

Entry points should publish an explicit load result, not rely on renderer failure side effects.

### Renderer Components

Renderer components own:

- Their DOM mount point.
- Their third-party renderer lifecycle.
- Updating rendered content when the loaded diagram changes.

Renderer components should not decide whether the generic load-failed panel appears.

## Rendering Rules

### Normal / Ready

When content is ready:

- Render the diagram slot.
- Render the bottom floating action pill.
- Render normal viewer actions.
- Do not render the load-failed panel.

### Loading

During initial async load:

- Keep the viewer shell mounted.
- Preserve renderer mount points if the renderer requires a stable DOM node.
- Do not show permanent load-failed UI.
- A lightweight loading state may be shown if the product wants one, but it must not destroy renderer-required DOM.

### Failed With Source

When load fails and a source identifier exists:

- Render the load-failed panel.
- Hide the diagram slot.
- Hide the bottom floating action pill.
- Show eye-off style icon or equivalent unavailable-content icon.
- Show heading: `This diagram isn't available`
- Show body: `You may not have permission to view it, or the source content has been removed. Other people on this page might still see it.`
- Show primary action: `Try again`
- Show secondary action: `Contact support`

### Failed Without Source

When load fails and no source identifier exists:

- Render the load-failed panel.
- Hide the diagram slot.
- Hide the bottom floating action pill.
- Show broken-link style icon or equivalent missing-source icon.
- Show heading: `The diagram data is no longer available`
- Show body: `The original diagram data couldn't be recovered. Contact support — or, if you manage this page, remove and recreate this macro.`
- Show primary action: `Contact support`
- Do not show `Try again`.

## Interaction Design

### Try Again

The retry action should rerun the complete viewer load process.

Preferred behavior:

- Reload the current Confluence page or iframe so Forge context, custom content lookup, recovery, paywall checks, and renderer setup all run again.

Alternative behavior:

- Trigger an internal viewer reload only if it is equivalent to a fresh initial load and cannot skip recovery or renderer update steps.

The retry action must not:

- Create custom content.
- Save macro configuration.
- Attempt a page-editor writeback.
- Mutate diagram data.

### Contact Support

The Contact support action is a two-step user experience:

1. Copy diagnostic context and show a toast.
2. After a short delay, open the support portal.

Rationale:

- The support portal may steal focus or navigate the host shell.
- The delay lets the user read the toast and understand that diagnostic data was copied.

Recommended delay:

- About 1.5 seconds.

Support URL:

- `https://zenuml.atlassian.net/servicedesk`

Toast copy:

- Success: `Diagnostic info copied — paste into your ticket`
- Copy failure: `Couldn't auto-copy. Content ID: <content id or unknown>`

Diagnostic payload format:

- Plain text.
- One field per line.
- No JSON required.
- Unknown values should be explicit as `(unknown)`.

Required fields:

- Summary line.
- Custom content ID.
- Page ID.
- Macro UUID/local ID.
- Space key.
- Client domain.
- Module key.
- App version and product type.
- Forge environment.
- Cloud ID.
- Direct fetch status.
- Load error HTTP status.
- Load error code.
- Load error class.

## Telemetry Design

### Exposure Event

Emit when the load-failed panel is shown.

Required dimensions:

- Whether the state has a source identifier.
- Source identifier if available.
- Generic panel scope.

Recommended state values:

- `with_id`
- `no_id`

Deduplication:

- A single viewer mount should emit at most one exposure event for the same failed state.
- If a loading state later transitions into a failed state, emit when the failed state first appears.
- Do not emit on every reactive render.

### Support Click Event

Emit when Contact support is clicked.

Required dimensions:

- Source identifier if available.
- Generic panel scope.

The event should fire before opening the support portal.

## Accessibility Design

The panel should:

- Use `role="alert"` or an equivalent assertive status pattern.
- Have visible heading text.
- Have visible button text.
- Keep icons decorative unless they communicate unique information.
- Preserve keyboard access to actions.
- Avoid hover-only affordances.

The viewer must not expose disabled or irrelevant toolbar buttons to keyboard navigation while the load-failed panel is active.

## Visual Design

The panel uses a centered, low-noise empty state. It should look like part of the viewer, not like a modal or page-level outage.

Recommended structure:

- Icon circle.
- Heading.
- Body text.
- Action row.

Recommended CSS:

```css
.viewer-load-failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 44px 24px;
  text-align: center;
  color: #374151;
}

.viewer-lf-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  background: #F3F4F6;
  border-radius: 50%;
  color: #6B7280;
  flex-shrink: 0;
}

.viewer-lf-icon {
  width: 22px;
  height: 22px;
}

.viewer-lf-heading {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  line-height: 1.3;
}

.viewer-lf-body {
  margin: 8px 0 0;
  max-width: 420px;
  text-align: center;
  font-size: 14px;
  color: #4B5563;
  line-height: 1.55;
}

.viewer-lf-actions {
  display: flex;
  gap: 8px;
  margin-top: 22px;
  flex-wrap: wrap;
  justify-content: center;
}

.viewer-lf-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  background: #0052CC;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.viewer-lf-btn-primary:hover {
  background: #0747A6;
}

.viewer-lf-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  background: #fff;
  color: #374151;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.viewer-lf-btn-secondary:hover {
  background: #F9FAFB;
}
```

Responsive requirements:

- The action row wraps on narrow widths.
- Text remains readable at small macro widths.
- Buttons must not overflow the viewer canvas.
- The panel must retain at least 24px horizontal padding.

## Integration With Existing Viewer Chrome

The load-failed panel sits inside `.viewer-canvas`.

When active:

- `.screen-capture-content` for the diagram is not shown.
- `.viewer-edge-bottom-pill` is not shown.
- Top actions may remain visible, but actions that depend on loaded content should be disabled or hidden if they cannot operate safely.

Design reason:

- The floating pill overlaps the lower canvas area and can cover the retry/support buttons.
- Copy/export/version actions cannot succeed when no diagram is loaded.

## Error Classification

The viewer load process should classify failures before handing state to `GenericViewer`.

Minimum classification:

- `failed_with_source`: failed custom content ID exists.
- `failed_without_source`: no content ID or no recoverable data.

Optional metadata:

- HTTP status.
- Direct fetch status.
- Error code.
- Error class.
- Recovery path attempted.
- Whether orphan recovery was attempted.
- Whether legacy fallback was attempted.

The UI copy should stay stable even if metadata changes.

## Safety Constraints

1. Do not show load-failed UI during the normal placeholder phase before async document loading has completed.
2. Do not destroy imperative renderer mount nodes unless the viewer has definitively entered a failed state.
3. Do not use `NULL_DIAGRAM` alone as the failed-state signal.
4. Do not attempt repair writes from viewer-launched modal contexts.
5. Do not expose customer names, page titles, or raw hostnames in public files or checked-in fixtures.
6. Do not block healthy renderer updates with load-failed state.

## Test Design

### Unit Tests

Viewer presentation:

- Failed with source renders retryable copy.
- Failed without source renders unrecoverable copy.
- Healthy state renders the diagram slot.
- Failed state does not render the diagram slot.
- Failed state does not render the bottom action pill.
- Retry button exists only in failed-with-source state.
- Support button exists in both failed states.

Interaction:

- Retry triggers the chosen reload mechanism.
- Contact support attempts clipboard copy.
- Contact support shows a success or failure toast.
- Contact support emits click telemetry.
- Contact support waits before opening the support portal.

Diagnostics:

- Payload contains all required diagnostic labels.
- Missing fields render `(unknown)`.
- Source identifier is included when available.

Telemetry:

- Exposure event fires when failed state appears.
- Exposure event includes `with_id` or `no_id`.
- Exposure event does not spam on unrelated re-renders.

### E2E / Spot Checks

Healthy viewer checks:

- Sequence still renders after async load.
- Mermaid still renders after async load.
- PlantUML still renders after async load.
- Graph still renders after async load.
- OpenAPI still renders after async load.
- OpenAPI fullscreen still renders and has a sane Swagger container width.

Failure checks:

- Broken custom content ID shows retryable load-failed state.
- Missing content ID shows unrecoverable load-failed state.
- Contact support opens the support portal.

## Rollout Plan

1. Add explicit viewer load-state modeling.
2. Add generic load-failed panel to `GenericViewer`.
3. Wire viewer entry points to publish failed-with-source or failed-without-source.
4. Add unit tests for presentation, telemetry, diagnostics, retry, and support.
5. Run local unit tests.
6. Run staging spot checks for healthy OpenAPI and at least one other renderer.
7. Add targeted staging failure spot check if a safe test fixture exists.

## Open Questions

1. Should retry reload the entire Confluence page, the Forge iframe, or a viewer-level load method?
2. Should Contact support be a link, a button, or a menu item for screen reader semantics?
3. Should failed-with-source copy mention permissions first or deletion first?
4. Should fullscreen viewer show the same copy as inline page viewer?
5. Should load-failed exposure telemetry be emitted by `GenericViewer` or by the load orchestrator?
