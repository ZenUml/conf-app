# Mermaid inline editing introduction · #1312

The comparison uses a 1280 × 760 Chromium viewport, the actual Workspace editor in Storybook, and fictional Order tracking and Publishing workflow diagrams. The before capture used `204907399`. Its only change from `a6718484b` was the analytics declaration, so the workspace rendered the same UI. The after capture uses `c22c9d437`.

| Test | Observed result |
|---|---|
| First Sequence and Flowchart | Each displays a centered scrim and modal. The source is on the left and the example diagram is on the right. |
| Playback | The initial labels become Confirm order and Approve. Sequence line 4 and Flowchart line 2 highlight the replacement. Flowchart retains node B and both arrows. The real source remains unchanged. |
| Blocking, keyboard and focus | Real mouse and wheel input fail to reach source, preview, and toolbar. Tab and Shift+Tab wrap between Close and Got it. Close, Got it, and Escape work during and after playback. Source and previous toolbar focus are restored. |
| Seen state | A fixture account follows Sequence → Flowchart and a second follows Flowchart → Sequence. Both types skip after document navigation with the browser cache removed and fixture Confluence user properties retained. Exit mid-animation consumes only the shown type. ER consumes neither. |
| Reduced motion | Both final views are immediately visible with reduced motion emulated in Chromium. |
| Paywall priority | The paywall is visible, with neither tutorial nor seen marker. Continue editing makes the Flowchart introduction eligible. |

Open Storybook, then run `STORYBOOK_PORT=6006 python3 check-storybook.py`. The script uses a dedicated agent-browser session. See [browser results](storybook.txt). The Storybook fixture uses a simulated Confluence user-property API. Real Confluence checks are recorded in the PR as they complete.

Local checks on `c22c9d437` passed. `pnpm lint` ended with zero errors, `pnpm test:unit` passed 9,990 tests with three skipped, and `pnpm build:lite` completed.
