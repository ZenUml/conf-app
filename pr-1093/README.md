# PR 1093 evidence

Baseline: cded35759e6560b4e22ffcda5bdcc13cc1f9d7f8. Candidate: a01b9968861b8ee6f7272380d8eab854b0160da6.
Source: Storybook story Viewer/LicenseNotice, fictional fixture, 800x600 browser pane.
Command: PRODUCT_TYPE=full pnpm exec storybook dev -p 6016 --ci.
The debug strip shows 459df518 because it is fixed at server start; the template change after that commit was hot-reloaded before capture.

Observed in NoticeOn: watermark present, not inside the capture node, pointer-events none, z-index 1; strip and button present.
Observed in NoticeOff: no watermark, no strip, canvas class is only viewer-canvas.
Not verified: Forge Tunnel, CI-deployed Staging, a real Forge license value.
