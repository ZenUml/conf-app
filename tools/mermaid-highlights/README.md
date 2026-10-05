# Mermaid highlights

A standalone local developer tool and browser module for highlighting connections in an existing Mermaid flowchart. The app's real Mermaid component can opt into this module; the viewer feedback composition below is available for Storybook review.

Hover or focus a node to trace its incident connectors and neighbors. Hover a connector to trace its endpoints. Click, Enter, or Space locks the selection; a second click or Escape clears it. `reset()` clears interaction state. `destroy()` removes the installed layers and restores renderer attributes and status content. Node and edge hit areas forward clicks to the original elements, preserving direct and delegated callbacks.

## Browser module

Serve the `src/` directory as browser ES modules. Use your existing Mermaid instance:

```js
import {readMermaidFlowchartModel, attachMermaidHighlights}
  from './src/mermaid-highlights.mjs';

let controller;
let renderQueue = Promise.resolve();
function renderHighlighted(source, host, status) {
  const job = renderQueue.then(async () => {
    controller?.destroy();
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    // Snapshot immediately: Mermaid's database can change on later renders.
    const model = readMermaidFlowchartModel(diagram);
    const rendered = await mermaid.render('highlighted-flowchart', source);
    host.innerHTML = rendered.svg;
    rendered.bindFunctions?.(host);
    await document.fonts.ready;
    controller = attachMermaidHighlights(host.querySelector('svg'), model, {status});
    return controller;
  });
  renderQueue = job.catch(() => {});
  return job;
}
```

Serialize all renders that share this Mermaid instance, including callers outside this example. Attach only after mounting the SVG. The adapter snapshots Mermaid node and edge identity and validates every binding before altering an existing highlighted diagram. It retains the rendered paths and label geometry.

## Local offline HTML export

Provide local dependencies through environment variables (or the equivalent function options):

```sh
export MERMAID_HIGHLIGHTS_PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright
export MERMAID_HIGHLIGHTS_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium
export MERMAID_HIGHLIGHTS_MERMAID_BUNDLE=/absolute/path/to/mermaid.min.js
node tools/mermaid-highlights/kit/export-mermaid-interactive.mjs input.mmd output.html
```

The exporter renders with local Mermaid and headless Chromium, blocks render-time network requests, and writes a self-contained HTML file with fit/native-size controls. The output opens offline without Mermaid or Playwright. Its receipt includes source, SVG, bundle, and output hashes. The programmatic `exportMermaidInteractive(source, options)` accepts a string or UTF-8 Buffer and an absolute `outPath`; options are `mermaidBundlePath`, `playwrightModulePath`, and `browserExecutablePath`. Playwright falls back to the locally resolvable `playwright` package when its module path is omitted, and its default Chromium when the executable path is omitted.

## Scope and limitations

Supported: Mermaid flowcharts with resolvable node DOM IDs and edge IDs, curved and parallel connectors, explicit edge IDs, and HTML labels. Subgraphs can contain nodes; connectors whose endpoints are group IDs are rejected. Other Mermaid diagram types are rejected. Invisible connectors are excluded from interaction.

The adapter depends on Mermaid's flowchart database and rendered DOM structure; upgrades need verification. Attach again after rerendering or geometry changes. Export preserves the rendered diagram and highlights, but does not serialize application callbacks or Mermaid `bindFunctions` closures. The renderer uses strict security mode and a neutral theme. External resources are blocked. Source is limited to 256,000 bytes. This is a local tool, with no dependency installation or hosted rendering service.

## Tests and provenance

With the three environment variables configured, run:

```sh
node --test tools/mermaid-highlights/test/mermaid-highlights.test.mjs
```

There are nine tests, including actual Mermaid browser interaction, callback forwarding, lifecycle restoration, identity validation, touch interaction, offline export, label preservation, and pan/zoom geometry. Eight browser tests skip when Playwright module or Mermaid bundle paths are missing.

Extracted from commit `bd78520a683e978f665219b8e0c87794c01328cf`, originally under `tools/pi-diagram-agent/`. Runtime environment variables and Symbol namespaces now belong to this independent tool. The generic runtime retains optional `sharedSections` support; the Mermaid adapter installs no shared sections. No static SVG exporter is required.

## Real viewer feedback Storybook review

Open **Viewer / MermaidHighlightIntegration** in Storybook for actual DiagramPortal inline, fullscreen, unsupported Mermaid sequence, and preview contexts. The integration fixtures use synthetic English labels. **Viewer / MermaidHighlightFeedbackPrototype** retains the five feedback-state stories. The five existing stories cover interactive, question, liked, disliked/reason, and dismissed states. The selected design is the adjacent 260 px sidebar card. The card appears after meaningful use and disappears when disabled or dismissed. No empty hint rail remains. The floating review tray only restarts the experience and shows memory-only state and events.

The story composes the real `GenericViewer`, `Mermaid`, and `DiagramViewport` components through the opt-in `MermaidHighlightViewer` wrapper. Source, diagram zoom, and pan use the existing viewer implementation. The real Mermaid component attaches the relationship highlighter only when explicitly enabled. DiagramPortal enables this composition for normal Mermaid viewing, preserving the existing wide/autoResize setting. Header-free and read-only previews keep the existing viewer path.

The synthetic fixture has eight nodes and ten connectors. Actual highlighting usage (700 ms continuous hover, click, or keyboard focus) gates the feedback question. Like shows thanks; dislike offers optional bounded reasons. Closing or skipping leaves highlighting enabled and keeps feedback closed across toggle cycles. The header toggle controls highlighting independently. A new diagram starts a fresh feedback session with highlights enabled so its support can be checked. Footer and toolbar feedback variants have been removed.

`MermaidHighlightFeedback` owns the reusable feedback flow and planned analytics events. Storybook uses local bundled Mermaid, a Vuex fixture, safe Forge/AP stubs, and the analytics noop alias. It sends no feedback or telemetry. State and the debug event log stay in memory; source, tenant, and free-text feedback are never added to event payloads. The actual app integration is implemented locally; no deployment has been performed.

Export capture temporarily removes highlight layers and restores normal diagram appearance synchronously before the real ExportModal preview captures. Closing export reinstalls highlights without resetting feedback usage. Analytics distinguish inline `viewer` from `fullscreen` and carry only bounded interaction fields.
