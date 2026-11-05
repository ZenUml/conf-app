# PR #1053 evidence: Graph auto-title accepts model refusal text

- Baseline: `fadc1009` (main). Tunnel and Storybook candidate: `916274cd`. Final candidate on staging: `79193b50`, deployed as PR merge commit `8ad132b`, Pages deployment `9e408f5d`.
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

## Staging, final candidate

| File or probe | Steps | Observed |
|---|---|---|
| `after-staging-debug-bar.png` | lite-stg page 382402571 with `zenumlDebug` on | Debug bar shows `8ad132b` on macro 382697473 |
| `after-staging-editor-empty.png` | Open the editor for macro 382697473, wait 18 s | Title stays empty |
| `after-staging-ai-button.png` | Click the AI button, then close without publishing | Title is "Control" |
| `POST https://9e408f5d.conf-stg-lite.pages.dev/ai-generate-title`, `Control`, `flowchart`, 12 calls | Sent as an editor without this fix would | 0 refusals, 0 "ZenUML". 1 reply was "Hello, world!" |
| Same URL, two labels, 6 calls; sequence, 3 calls | | 0 refusals |

The BEFORE capture is macro 382631937, the first macro on the same page, with the one label `Control`. Macro 382697473 was not opened on the old build in this session.

## Limits

- The tunnel serves the frontend only. Its backend is the staging deployment, so the backend guard is checked by unit tests until the staging deploy of this branch.
- A real refusal from the model was not forced in the tunnel. The editor guard for that case is shown in Storybook with a mocked reply and in unit tests.
