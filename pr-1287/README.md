# PR 1287 evidence: Vite 8 (Rolldown) build

Baseline: `main` at `8387cf64` (Vite 7). Candidate: `build/vite-8-rolldown` at `c35ec5b0` (Vite 8.3.8). Captured 2026-11-22.

| Stage | How | Result |
|---|---|---|
| Storybook | `PRODUCT_TYPE=lite npx storybook build` on both SHAs, served statically, 7 viewer stories screenshotted headless (1280x577) | 4 of 7 byte-identical; 3 differ only in the footer branch/version label (`storybook-footer-label-diff.png`). Same SVG and stylesheet counts on all 7. Build time 48.3 s (Vite 7) vs 10.3 s (Vite 8) on an M4 |
| Forge tunnel | `FORGE_TUNNEL=1 PORT=8080 pnpm start:local:raw` + `forgex tunnel -e pr`, test site lite-dev, browser signed in as the Forge account | Dev bar shows `build/vite-8-ro…@c35ec5`; Graph shape and OpenAPI (Swagger styles, coloured `GET`) render styled (`tunnel-*.jpg`) |
| CI-deployed slot | Tunnel stopped; same pages load the bundle that PR validation run 44985067143 deployed to Forge env `pr` (last deploy 04:29:44Z, no later deploy) | Graph and OpenAPI render styled (`slot-cdn-*.jpg`) |

Pages are E2E smoke fixtures on the team test site. Limitation: the production bundle hides the dev bar, so the slot stage identifies the build by the environment's deploy time, not an on-screen label.
