# PR #1182 Evidence Bundle (#1161 Phases a & b)

- **Baseline SHA (`BEFORE`)**: `fd70262ba8aa5cdf67a42d85ec8e63c446208379` (`origin/main`)
- **Candidate SHA (`AFTER`)**: `f1ae56c9ffb4add33d466739b86c2e5a7c8f9f5a` (`refactor/issue-1161-openapi-vue-shell`)
- **Viewport / Browser**: 1280x800 (standalone editor `/index.html?sandbox=openapi-edit`) and 1280x600 (Storybook `Editor/Diagram/SwaggerForgeEditorShell`), Chromium (`channel: 'chrome'`).

## Screenshots

- `before-openapi-editor-header.png` vs `after-openapi-editor-header.png` — OpenAPI editor header (title input with AI spark button, AI Chat toggle, Help button, Publish button) and SwaggerEditor workspace.
- `before-openapi-editor-syntax-error.png` vs `after-openapi-editor-syntax-error.png` — OpenAPI editor with YAML syntax error showing the header parse warning note and bottom `SyntaxErrorBox` with `AI Repair` button.
- `storybook-openapi-default-header.png` & `storybook-openapi-syntax-error.png` — Storybook `Editor/Diagram/SwaggerForgeEditorShell` stories (`DefaultHeader` and `WithSyntaxError`).

## Test & Build Results

- `pnpm test:unit`: PASS — 491/491 active test files (6,844 passed, 3 skipped).
- `npx tsc --noEmit`: PASS — 674 on `origin/main` → 672 on `f1ae56c9` (0 new errors).
- Variant builds (`full`, `diagramly`, `lite`, `asyncapi`): PASS.
