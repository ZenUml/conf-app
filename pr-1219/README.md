# PR #1219 evidence — Export PNG with an image that cannot be fetched

Baseline: `main` @ cff157ef. Candidate: `fix/graph-export-unloadable-images` @ bb84d01c.

| File | What it shows |
|---|---|
| before-storybook-fail.jpg | Storybook `Modal/ExportModal` → "Graph with an icon that cannot be fetched" on the baseline code: preview stays "Preparing preview…", interaction test FAIL |
| after-storybook-pass.jpg / after-storybook-preview.jpg | Same story on the candidate: preview renders, Download clicked, test PASS |
| tunnel-macro-devbar.jpg | Forge tunnel on a dev site (Lite, development env): dev bar shows branch `fix/graph-expor…@bb84d0…`, Graph macro with an icon whose href is `https://icons.example.invalid/cloud-icon.png` |
| tunnel-export-preview.jpg | Export PNG dialog on that macro: preview 429 × 81 renders, icon area blank |
| tunnel-downloaded.png | The PNG file produced by Download (858 × 162) |
| harness-after.txt | Headless Chrome + Forge-like CSP, production `captureBlob` bundled with esbuild: strict mode still fails (C); skip mode succeeds and counts 1 skipped image (D, E), including after a cached failed fetch |

Fixture data is fictional. Limitation: the "Diagram backup could not be saved" toast in tunnel-macro-devbar.jpg is the backup PNG path, which keeps strict capture on purpose and is not changed by this PR.

## Staging (CI-deployed, 2026-11-19)

Lite staging, deployed by the PR validation run for head dc1093b7 (candidate merge 8e221a8). Test page created via REST with the same fictional Graph (icon href `https://icons.example.invalid/cloud-icon.png`), viewed as the robot test user.

| File | What it shows |
|---|---|
| stg-macro-devbar.png | Macro on lite-stg; dev bar shows build `8e221a8`; the icon shows as a broken image in the viewer |
| stg-export-dialog.png | Export PNG dialog: preview 451 × 81 renders, icon area blank |

Download image: a URL.createObjectURL hook recorded a 3,947-byte `image/png` blob; no error text in the dialog.
