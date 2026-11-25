# PR #1318 evidence

BEFORE: main e67199ba1 (seed `sequenceDiagram` Alice/John). AFTER: b8cb98af7 (seed `flowchart TD` review-and-approve).

Capture: each seed body rendered by the repo's bundled `mermaid` (node_modules/mermaid/dist/mermaid.min.js) in a plain page, default config, agent-browser Chrome, default viewport. Both rendered an `<svg>` without a parse error.

Limitation: this is the seed rendered standalone, not inside the Confluence editor. Storybook / Forge tunnel / staging checks are not part of this bundle.
