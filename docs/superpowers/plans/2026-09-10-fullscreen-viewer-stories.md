# Complete Fullscreen Viewer Stories — Implementation Plan

## Slice 1 — Sequence tracer

1. Add a story contract test requiring the Sequence Fullscreen export.
2. Add `Viewer/FullscreenViewer.stories.ts` with the shared production-viewer harness.
3. Mount the real `DiagramPortal` in Fullscreen context with valid Sequence DSL.
4. Add play assertions for Fullscreen chrome, a rendered diagram, the action toolbar, and the Fullscreen source panel.

## Slice 2 — Mermaid

1. Extend the contract test to require the Mermaid export.
2. Reuse the harness, preload bundled Mermaid, and render a wide flowchart.
3. Add the shared Fullscreen checks plus zoom-control assertions.

## Slice 3 — PlantUML

1. Extend the contract test to require the PlantUML export.
2. Reuse the harness and intercept the PlantUML server request with a representative SVG.
3. Add the shared Fullscreen checks against the normalized real PlantUML output.

## Verification

Run the focused story contract, Storybook title guard, ESLint, and a production Storybook build. Then inspect all three stories in a browser, require a non-zero preview rectangle, exercise the Source panel, and confirm Mermaid zoom controls.
