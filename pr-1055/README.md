# PR 1055 evidence

- BEFORE: staging build `8a3518a8`, lite-stg page 382402571. Same fixtures.
- AFTER: branch `claude/graph-viewer-bundled-icons`, tree equal to `f83e145b`, base `fadc1009`.
- Fixtures: one Graph macro with bundled icons (`img/lib/azure2/networking/Subnet.svg`, `img/lib/mscae/Kubernetes.svg`) and one with an `icons.diagrams.net` icon.

| File | Stage | Observed |
|---|---|---|
| `before-staging-viewer.png` | CI-deployed staging, before | Bundled and external icons broken |
| `after-storybook.jpg` | Storybook | Bundled icons render. Story has no Forge CSP |
| `after-tunnel-viewer.jpg` | Forge Tunnel, lite-dev page 110821381 | Bundled icons render. External icon still broken |
| `after-tunnel-png-attachment.png` | `zenuml-111050760.png` downloaded by REST | Icons are in the saved PNG |

Tunnel identity: Vite on port 8080 had 8 established connections, and the macro dev bar shows this branch. Browser: the user's Chrome, through the Claude in Chrome extension, so frame-internal `location.host` was not read.
