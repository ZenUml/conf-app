# ADR-0001: Store pre-rendered Mermaid SVG in the Diagram model

**Status**: Accepted  
**Date**: 2026-06-04

## Context

Every Confluence page view that contains a Mermaid diagram causes the viewer iframe to cold-load the mermaid JavaScript bundle before anything is visible. The bundle is large and the iframe context is fresh on each page load — browser caching provides limited relief. The result is a blank diagram area for several seconds on first load.

The fix is to store the pre-rendered SVG alongside the diagram source so the viewer can inject it directly without loading the bundle.

## Decision

Add a `mermaidSvg?: string` field to the `Diagram` model (stored in Confluence custom content).

- **Write path**: the editor's `Mermaid.vue` component dispatches `updateMermaidSvg(svg)` to the Vuex store on every successful render. The save action picks it up as part of the normal full-Diagram serialisation. Code and SVG are always saved atomically — they cannot drift.
- **Read path (viewer)**: if `mermaidSvg` is present in the loaded Diagram, inject it via `v-html` immediately. The mermaid bundle is never loaded. If absent (legacy diagrams), fall back to the current live-render path.
- **Scope**: Mermaid only. ZenUML (Sequence) and other types are out of scope for this initiative.

## Alternatives considered

| Option | Reason rejected |
|---|---|
| Confluence attachment | Separate write step on save, separate read step in viewer — two extra API calls on every path |
| Cloudflare KV / D1 | Adds backend dependency to a viewer path that currently reads only from custom content (Forge) |

## Consequences

- Legacy diagrams (saved before this feature) have no cached SVG and fall back to live render. They get the benefit naturally when re-saved. No viewer-side backfill.
- A failed Mermaid render (invalid syntax) must not overwrite a previously valid cached SVG — guarded by `if (svg) dispatch(...)`.
- Custom content payload grows by the SVG size (typically 5–30 KB for Mermaid diagrams), well within Confluence custom content limits.
- Theme is not a concern: `Mermaid.vue` does not apply user-selectable themes, so the cached SVG never becomes theme-stale.
