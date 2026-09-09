# Complete Fullscreen Viewer Stories — Design

## Goal

Add three discoverable Storybook stories that render the complete production Fullscreen viewer for Sequence, Mermaid, and PlantUML diagrams. The stories are visual-review and interaction fixtures, not structural mockups.

## Storybook structure

Create `src/components/Viewer/FullscreenViewer.stories.ts` with the Storybook title `Viewer/FullscreenViewer` and these exports:

- `Sequence`
- `Mermaid`
- `PlantUML`

Their display names will identify each as a complete Fullscreen viewer. A dedicated file keeps the already-large `GenericViewer.stories.ts` focused and makes all three variants adjacent in the Storybook sidebar.

## Production component path

Each story mounts the real `DiagramPortal`. That exercises the production chain:

`DiagramPortal` → `GenericViewer` → the selected renderer.

The stories will not reproduce the viewer with Storybook-only markup. The real Fullscreen header, title, diagram-type chip, actions, canvas sizing, source panel, export entry point, and renderer-specific behavior remain in control of the production components.

## Story harness

A shared local harness in the story file will:

- install the real Vuex store;
- seed a saved custom-content diagram with a title and valid DSL;
- set `forgeGlobal.forgeContext.extension.modal.macroMode` to `fullscreen`;
- expose a realistic page, space, account, and custom-content context using invented identifiers;
- stub platform navigation, clipboard, analytics transport, permissions, and feature flags;
- keep Live Agent Link disabled so the stories show the generally available Fullscreen viewer rather than a tenant-specific experimental state;
- preload bundled Mermaid for the Mermaid story;
- intercept only the PlantUML server request and return a representative SVG.

No story may call a real Forge API, persistence API, analytics endpoint, AI backend, or PlantUML server.

## Variant behavior

### Sequence

Render a valid multi-participant checkout sequence with the real ZenUML renderer. The complete Fullscreen chrome and source-panel interaction must remain available.

### Mermaid

Render a wide architecture flowchart with the real Mermaid renderer. In addition to the shared Fullscreen chrome, the production zoom-out and zoom-in controls must be visible.

### PlantUML

Render a representative order-creation sequence. The production PlantUML component performs its normal validation and normalization against the locally supplied SVG response.

## Interaction checks

Each story's play function will verify:

- the title and correct Fullscreen diagram-type chip;
- the real diagram preview has rendered;
- Fullscreen-only layout is active and the inline-only Fullscreen button is absent;
- View Source opens the Fullscreen source panel and can close it;
- the standard viewer actions needed for visual review are present.

The Mermaid story additionally verifies both zoom buttons.

## Verification

The implementation is complete when:

1. a story contract test confirms all three exports;
2. the repository Storybook-title guard passes;
3. ESLint passes for the new files;
4. the production Storybook build succeeds;
5. all three stories are observed in a browser with non-zero diagram dimensions;
6. the source-panel interaction is observed in the UI; and
7. Mermaid zoom controls are observed in the UI.

## Scope

This work adds Storybook fixtures and their tests only. It does not change production viewer behavior, renderer behavior, analytics events, or application manifests. Existing analytics calls may execute against no-op transport inside the harness; no new event is introduced because there is no new user-facing feature.
