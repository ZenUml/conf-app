# Swagger Editor 5 migration assessment

Issue #1008; assessed 2026-10-27. Decision: keep Editor 4.14.8 for the Swagger UI upgrade and treat Editor 5 as a separate migration. This is a source and package assessment, not a tested migration.

- **Initialization and plugins:** `src/forge-swagger-editor.ts` mounts the React shell, then calls the 4.x bundle with `dom_id`, empty presets and `SpecListener`. The listener wraps `specActions.updateSpec` and exposes `window.updateSpec`, `window.specContent` and callbacks. Saving, dirty checks, store updates and validation depend on these globals. Verify the 5.x plugin/action API and replace this bridge where needed; do not assume the wrapper is compatible.
- **Editor integration:** test initial load, typing, AI-generated updates, validation, dirty-close, save and reopen, including dashboard editing. The shell and its CSS depend on the current editor's DOM layout (`Pane1`, `Pane2`, `Resizer`); inspect and adapt them for Monaco.
- **Resources and Forge:** 5.10.0 exports `apidom.worker` and `editor.worker`, and changes the CSS export to `swagger-editor/swagger-editor.css`. Determine Vite worker URLs and verify they load in a Forge iframe under the actual CSP; check network and console evidence before changing permissions. Upstream documents Monaco presets and warns that bundling can exhaust Node's heap.
- **Size:** npm reports unpacked package sizes of 18,964,452 bytes for 4.14.8 and 61,432,540 for 5.10.0. These are package sizes, not production bundle or download measurements. Compare built assets and load performance before deciding.
- **Estimate:** roughly 3–5 engineering days for a compatibility spike, implementation and ordered UI validation, subject to worker/CSP and plugin findings. This estimate is unverified; split further if the spike exposes incompatibilities.

Sources: [upstream Editor documentation](https://github.com/swagger-api/swagger-editor), npm metadata for versions 4.14.8 and 5.10.0. No Editor 5 code or dependency was introduced in this change.
