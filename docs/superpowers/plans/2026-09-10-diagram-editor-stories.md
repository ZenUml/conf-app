# Full Diagram Editor Storybook Stories — Implementation Plan

## Goal

Add three Storybook stories that mount the real `Workspace` editor shell for Sequence, Mermaid, and PlantUML. Each story must expose the complete editor surface while isolating Forge, persistence, analytics transport, and backend calls.

## Slice 1 — Sequence

1. Add a story contract test that requires a dedicated `Workspace.stories.ts` module and a Sequence export.
2. Add the shared Storybook harness:
   - install the real Vuex store;
   - seed a saved diagram with title and DSL;
   - set editor-mode Forge context;
   - stub platform, persistence-adjacent, analytics, and feature-flag seams;
   - render the real `Workspace` at full viewport height.
3. Add a Sequence story play check for the header, active type, code pane, rendered preview, enabled Publish button, and AI Chat open/close behavior.

## Slice 2 — Mermaid

1. Extend the contract test with a Mermaid export.
2. Reuse the shared harness with Mermaid DSL.
3. Preload the bundled Mermaid renderer and add play checks for the real SVG and zoom controls.

## Slice 3 — PlantUML

1. Extend the contract test with a PlantUML export.
2. Reuse the shared harness with PlantUML DSL.
3. Stub the PlantUML server response with a representative SVG and verify the rendered preview.

## Verification

1. Run the targeted story contract and story-title tests.
2. Run ESLint on the story and test files.
3. Build Storybook.
4. Start Storybook and visually inspect all three stories in the browser, including the editor/preview split and AI Chat interaction.

## Scope guard

No production components or runtime behavior change. No analytics event additions are needed because this is a Storybook-only fixture using already-instrumented production components.
