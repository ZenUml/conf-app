# PR #1073 — MCP promo surfaces: review evidence

- BEFORE: `ff56c579` (origin/main merge-base). AFTER: `0f835a92` (branch `feat/mcp-promo-surfaces`).
- Source: Storybook static builds (`npx storybook build`, PRODUCT_TYPE unset → lite default), served locally and captured with Playwright + Chrome. Fixture data only.
- Agent-link flag on via the stories' `mockAgentLinkEnabled` (standalone path of `isAgentLinkEnabled`).

## BEFORE / AFTER (same story at both SHAs)

| Story | BEFORE | AFTER |
|---|---|---|
| `Viewer/GenericViewer` › Header redesign — Mermaid inline (play opens More) | `inline-more-menu-before.png`: MCP button in header, no Copy for AI, menu without MCP | `inline-more-menu-after.png`: Copy for AI back in header, "Edit with AI tools · NEW" menu entry |
| `Viewer/GenericViewer` › Header redesign — Mermaid fullscreen | `fullscreen-before.png`: MCP header button | `fullscreen-after.png`: same header + bottom-left promo card |

DOM checks (compare.mjs): inline BEFORE `connect-mcp-btn`=1, `copy-for-ai-btn`=0; AFTER 0 / 1 and menu contains "Edit with AI tools". Fullscreen: `mcp-promo-card` 0 → 1.

## AFTER only (new surfaces; no equivalent on main)

- `fullscreen-card-dialog.png` — card CTA opens Connect MCP; card hides.
- `editor-new-diagram.png`, `editor-new-diagram-dialog.png` — `Editor/Diagram/WorkspaceMcpPromo` › New diagram card, and its draft-and-paste prompt.
- `editor-tip.png` — › Typing tip after 400 typed chars (story types 10 × 40 chars).
- `card.png`, `tip.png` — `Shared/McpPromoCard`.

Capture scripts: `shoot.mjs`, `compare.mjs` (expect Storybook builds served on :6107 after / :6108 before).

## Limitations

- Not yet validated through Forge tunnel or CI-deployed staging (see PR).
- Storybook editor stories render without the Forge modal frame; the dev debug strip in the preview is Storybook-only.
