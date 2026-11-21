# PR #1259 evidence: license notice strip left out of Fullscreen

- BEFORE: `083f601e1` (main) viewer code, with this PR's story. AFTER: `fd02d86e1`.
- Storybook (PRODUCT_TYPE=lite), story `viewer-genericviewer--mermaid-fullscreen-license-notice`, viewport 1600x900, fixture data (invented counts).
  - `storybook-before.png`: strip present in Fullscreen, its box 2px wide, content overflowing as a narrow card.
  - `storybook-after.png`: no strip, watermark present, page does not scroll.
- Forge tunnel, lite-dev, development environment, macro dev bar showed `claude/layout-issue-6958c4@fd02d86e1`, real Chrome 1512x726.
  - `tunnel-after-inline.jpg`: inline macro still shows the strip.
  - `tunnel-after-fullscreen.jpg`: Fullscreen modal shows the watermark only.
  - Limitation: lite-dev has no enforcement policy, so the notice state was forced on by a temporary local stub that was not committed.
