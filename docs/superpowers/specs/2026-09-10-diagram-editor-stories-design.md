# Full Diagram Editor Storybook Stories

## Goal

Add three directly addressable Storybook stories that exercise the complete Diagram Editor for Sequence, Mermaid, and PlantUML. These are development fixtures for inspecting the real authoring surface, not alternate production implementations.

## Stories

- **Diagram Editor — Sequence** starts with a representative ZenUML sequence DSL.
- **Diagram Editor — Mermaid** starts with a representative Mermaid sequence DSL and exposes the Mermaid pan/zoom controls in the preview.
- **Diagram Editor — PlantUML** starts with a representative PlantUML sequence DSL.

All three stories render at a full-viewport size and mount the same production `Workspace` component.

## Architecture

Create `src/components/Workspace.stories.ts`. A shared story harness initializes the real Vuex store and the minimum Forge globals required by `Workspace`, `Header`, `Editor`, `DiagramPortal`, syntax surfaces, and AI Chat. External boundaries such as Forge bridge calls, persistence, feature flags, and analytics transport are stubbed; production child components remain real.

Each story differs only in its initial diagram type, title, and DSL. Switching tabs continues to use the real editor behavior and shared store. The harness resets global and store state between stories so navigation order cannot leak state.

## Visible Surface and Interaction

Each story includes:

- the complete header with diagram tabs, title, Templates, Help, AI entry point, and Publish state;
- the real code editor and draggable editor/preview split;
- the real diagram preview for the selected type;
- syntax error and foreign-dialect surfaces;
- the real AI Chat panel shell and its open/close behavior;
- Mermaid zoom controls when Mermaid is active.

Saving and remote AI responses are not performed. The Publish button may exercise local validation and mocked persistence only, so Storybook cannot modify Confluence content.

## Verification

Story play functions verify that each fixture:

1. renders the full header and both workspace panes;
2. selects the expected initial diagram tab;
3. contains the expected DSL and a rendered preview;
4. exposes an enabled Publish state when a title is present;
5. opens and closes the AI Chat panel;
6. for Mermaid, displays working zoom controls.

Run the focused story tests, relevant unit tests, lint, and a production Storybook build. Perform a browser spot check of all three stories at desktop dimensions.

## Analytics and Production Impact

No new analytics events are required because this work only adds Storybook fixtures and does not change production behavior. Existing component analytics calls are intercepted by the harness.

## Non-goals

- No redesign of the Diagram Editor.
- No separate Lite, Full, or Diagramly implementations.
- No real Confluence save, AI request, or backend dependency.
- No changes to existing production feature flags or renderer behavior.
