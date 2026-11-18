# PR #1220 evidence — toolbar zoom step x1.25

- Baseline: `main` (b4f75905). Candidate: `9d6c9929` (Storybook capture on pre-rebase `54212745`, same diff).
- Storybook: one Zoom in click from the opened view. `*-main.png` = main, others = candidate.
- Forge tunnel: lite-dev, dev environment, Fullscreen modal, one Zoom in click. Dev bar shows `claude/p2-zoom-…@9d6c99` (`tunnel-devbar.png`).
- Fixtures: fictional (wide Mermaid flow, long Sequence `Client/Gateway/...`, 4-node Graph).
- Measured: Mermaid node spacing 31.4 -> 38.8 px (x1.24); Sequence participant spacing 53 -> 66 px (x1.245); Graph node width 69 -> 87 px (x1.26). Pixel reads from screenshots, +-1 px.
- Limitation: CI-deployed staging not yet checked.
