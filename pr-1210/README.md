# PR 1210 evidence: byline Flowchart tile seeds a flowchart

- BEFORE: Full staging, main `599802c` (2026-11-17). Byline > Flowchart tile opened the Mermaid tab with the `sequenceDiagram` Alice/John sample behind the starter gallery.
- AFTER: Forge tunnel on the Lite development site, candidate `e947f667`, 2026-11-17, desktop Chrome, Forge CLI account. Flowchart tile opens Mermaid with a `flowchart TD` sample (Request received > Valid input? > Process order / Return error > Send confirmation); auto title "Order Processing Workflow". Gallery did not reopen because its first-open key was already set in this browser.
- Mixpanel (same session): `macro_create_started seed_kind=flowchart macro_type=mermaid creation_origin=byline_view`.
- Storybook: flowchart seed story PASS (`storybook-flowchart-seed.jpg`).
