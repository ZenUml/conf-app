# PR #1053 evidence: Graph auto-title accepts model refusal text

- Baseline: `fadc1009` (main). Candidate: `916274cd` (`fix/auto-title-refusal-text`).
- Viewport: 1568 x 713 for the tunnel captures.

## Captures

| File | Source | Steps | Observed |
|---|---|---|---|
| `before-lite-stg-editor-refusal-title.png` | lite-stg, deployed staging build, page 382402571 | Open the Graph editor for a one-label diagram. Do not publish. | Title box holds "Please provide the DSL describing the flowchart diagram. I'll help you create a" |
| `storybook-single-label.png` | Storybook, `916274cd` | Story `editor-graph-drawioextension--single-label` | Title stays empty for 2 s, then "Control" after the AI button |
| `storybook-model-refusal.png` | Storybook, `916274cd` | Story `editor-graph-drawioextension--model-refusal` | Title stays empty |
| `after-tunnel-editor-single-label-empty.jpg` | Forge tunnel, lite-dev, `916274cd` | Open the editor for a one-label diagram, wait 18 s | Title stays empty |
| `after-tunnel-ai-button-single-label.png` | Forge tunnel, lite-dev, `916274cd` | Click the AI button | Title is "Control" |
| `after-tunnel-editor-two-labels-model.jpg` | Forge tunnel, lite-dev, `916274cd` | Open the editor for a two-label diagram, wait 18 s | Model title "Data Processing Flow" |
| `after-tunnel-published-single-label.jpg` | Forge tunnel, lite-dev, `916274cd` | Publish the one-label diagram with an empty title | Viewer heading is "Control" |

## Limits

- The tunnel serves the frontend only. Its backend is the staging deployment, so the backend guard is checked by unit tests until the staging deploy of this branch.
- A real refusal from the model was not forced in the tunnel. The editor guard for that case is shown in Storybook with a mocked reply and in unit tests.
