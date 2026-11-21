# PR #1259 evidence: license notice width in Fullscreen

- BEFORE: `90b58743c` (main) viewer CSS, with this PR's new story. AFTER: `e861fd3bf`.
- Storybook (PRODUCT_TYPE=lite), story `viewer-genericviewer--mermaid-fullscreen-license-notice`, viewport 1600x900, fixture data (invented counts).
  - `storybook-before.png`: strip box measured 2px wide; content overflows as a narrow card.
  - `storybook-after.png`: strip measured 1000px wide, centred; button beside the text.
- Forge tunnel, lite-dev, development environment, branch `claude/layout-issue-6958c4@e861fd3bf` shown in the macro dev bar, real Chrome 1512x726.
  - `tunnel-after-fullscreen.jpg`: Fullscreen modal, strip fills the byline's column.
  - Limitation: lite-dev has no enforcement policy, so the notice was forced on by a temporary local stub that was not committed. The CSS under test is the committed one.
- Known and not changed here: at windows narrower than about 1650px the MCP promo corner card overlaps the strip's left end (visible in `storybook-after.png`).
