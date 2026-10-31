# L2 browser rendering evidence

Use this after an AI Repair candidate has passed the deterministic syntax and required-anchor checks. Render the **candidate from this run** with the Mermaid version installed in the current Diagramly checkout. Keep production-derived DSL, generated pages, SVG, and screenshots under the run's private case directory (`0700` directory, `0600` files). Record the candidate SHA-256 so the browser evidence can be matched to the scored output.

## One candidate: local Chrome render

The 2026-10-19 L2 validation used `@playwright/test` from Diagramly with local headless Chrome. Use this procedure for one candidate:

1. Resolve the Mermaid browser bundle and package version from the **current** Diagramly web app installation. Create a browser context at the standard desktop viewport (`1440 × 900`), then create a blank page with a `#preview` element using `page.setContent` and load the local Mermaid bundle with `page.addScriptTag({ path: bundle })`.
2. In the page, initialize Mermaid with `startOnLoad: false` and `securityLevel: 'strict'`. Run `mermaid.parse(candidate)` and `mermaid.render(id, candidate)`, then insert the returned SVG into `#preview`.
3. Confirm that `#preview` contains one SVG with nonzero rendered width and height. Save the SVG, a screenshot of `#preview`, and a JSON evidence record. Inspect the screenshot to confirm that the diagram is visibly drawn and that an error graphic or blank canvas was not mistaken for success.
4. Record the Mermaid version, browser version, viewport, candidate SHA-256, parse/render result, SVG count and dimensions, and evidence paths. Preserve any exception and failed screenshot as failure evidence. A parser-only result or a nonempty SVG string is insufficient for L2 PASS.

Read the candidate from its private result path. Do not put DSL text in a command argument, URL, public file, or terminal output. Resolve the bundle path at run time rather than copying a historical `node_modules` path.

## Batch: inspect visible previews in the built-in browser

The 2026-10-19 historical regression also verified each candidate in the Codex built-in browser. Generate one private HTML page per case; each page loads the installed Mermaid ESM bundle, calls `parse` and `render` on that case's candidate, inserts the SVG, and reports success only when the SVG has nonzero bounds. Serve that private directory with an HTTP server bound to `127.0.0.1` on an ephemeral port. Use only local resources, and keep the generated HTML and server output private; base64 encoding in a page is not data protection.

At the standard desktop viewport, open each case's local page in the built-in browser. Wait for its render status, confirm the SVG exists and has visible dimensions, and inspect the preview or its screenshot. For an offline PlantUML SVG, confirm the image has loaded and `naturalWidth` and `naturalHeight` are positive. Save per-case browser observations and screenshot paths, then close the temporary tab and stop the local server.

For PlantUML, first validate and render with a local CLI, JAR, or container whose network is disabled; do not send production DSL to a separate online rendering service. A displayed SVG is evidence of browser presentation only when the offline renderer's syntax result is also recorded.

Use the browser evidence together with the current model output, non-no-op check, and required anchors when deciding L2. Historical previews belong to their own run and do not validate a new candidate or Prompt version.
