# PR 1027 — PlantUML PNGs from the local engine (ADR-0010 step 6)

Candidate: `699e45fc` (branch `claude/happy-pascal-lxzeuf`). Baseline: `main` @ `b38b5acb`, where every PlantUML PNG is fetched from `www.plantuml.com/plantuml/png/<encoded>`.

## Capture
`run.mjs` bundles `harness.ts` with Vite around the real `src/utils/plantuml/engine.ts`, `png.ts` and `model/captureBlob.ts`, serves it under
`script-src 'self'; img-src 'self' data: blob:`, and drives headless Chromium (Playwright). The Forge flag lookup and Mixpanel are stubbed
(`renderer-stub.ts` answers `local`, `track-stub.ts` records events). Fixtures are synthetic diagrams (sequence, class, C4 stdlib).

## Observed (`result.json`)
| diagram | local SVG external refs | backup (upscaled) | Export PNG | html-to-image on inlined local SVG |
|---|---|---|---|---|
| sequence | none | 1400×1741 | 119×148 | 800×999, not blank |
| class | none | 1400×2034 | 128×186 | 800×1167, not blank |
| C4 | none | 1400×3634 | 89×231 | 800×2080, not blank |

- Requests outside the page: **0**. CSP messages: **0**.
- Events: `plantuml_png_produced` with `plantuml_png_source=local`, purpose `backup` (`plantuml_png_upscaled=true`) and `export`.

## Limitations
Not a Forge iframe. The real Forge check (zero `www.plantuml.com` requests from the macro iframe, backup uploaded, Export PNG working)
needs a deployed build with the flag on and is still open.
