# Mermaid highlights

A standalone local developer tool and browser module for highlighting connections in an existing Mermaid flowchart. It does not integrate with the Confluence app, backend, or analytics.

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

There are eight tests, including actual Mermaid browser interaction, callback forwarding, lifecycle restoration, identity validation, touch interaction, offline export, and label preservation. Seven browser tests skip when Playwright module or Mermaid bundle paths are missing.

Extracted from commit `bd78520a683e978f665219b8e0c87794c01328cf`, originally under `tools/pi-diagram-agent/`. Runtime environment variables and Symbol namespaces now belong to this independent tool. The generic runtime retains optional `sharedSections` support; the Mermaid adapter installs no shared sections. No static SVG exporter is required.

## Viewer feedback Storybook prototype

The throwaway `src/components/Viewer/MermaidHighlightFeedbackPrototype.vue` explores when and where to ask readers for feedback. Run `pnpm storybook` and open **Viewer / MermaidHighlightFeedbackPrototype**. The five stories start at interactive, visible question, liked, disliked/reason, and dismissed states. On the same story route, `?variant=footer`, `?variant=toolbar`, and `?variant=sidebar` compare inline footer feedback, a toolbar popover, and an adjacent card. The floating prototype tray switches variants and restarts the experience.

The fixture is a synthetic eight-node order flow. The real standalone module drives highlighting. The question appears only after a continuous 700 ms hover or node/edge click or focus; the toolbar variant then offers a feedback button. The reserved footer keeps the canvas height stable. Dislike offers optional bounded reasons; dismissing feedback leaves highlighting enabled. The toolbar separately controls highlighting.

All state and the small event log live in memory. Storybook aliases `trackAnalyticsEvent` to its noop stub, so there is no real telemetry or backend request. Planned events are registered in the app analytics catalog before the prototype; no production viewer imports this component. The dark tray shows prototype state and events separately from the product UI. These alternatives are for review, not a production implementation.

Live Storybook review confirmed the initial hidden prompt, node click and keyboard reveal, like confirmation, optional dislike reason, dismissal with no inferred answer, independent highlight disable, and all three placements. The actual fixture rendered eight nodes and ten connectors. The 700 ms hover gate is present in code; isolated hover timing was not separately driven in that UI review. No prototype render error was observed.
