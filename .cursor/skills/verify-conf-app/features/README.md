# conf-app verification map

This directory is the maintained source for verifying the user-facing behavior of the ZenUML Confluence macro. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch the Storybook stand-in with `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs launch`.
- `doctor` must report `surface: storybook`, a live pid, and `storyIndexReady: true`.
- Browser commands use session `conf-app-verify` at viewport `1440x900`. Do not reuse session `conf-app`.
- Storybook seeds each story in memory. It does not read or write Confluence custom content.
- Never drive a Storybook this CLI did not start.

## Driving conventions

- Start every recipe from a fresh `browser open-story` unless its preconditions say otherwise.
- Prefer `data-testid`, ARIA roles, and accessible names.
- Treat every command as literal. Keep story ids, selectors, and flags unchanged.
- Hover `.viewer-surface` before expecting Edit, Source, Copy for AI, or Fullscreen to be visible.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an accessibility snapshot and a screenshot.
- Record the feature id via `--feature` on snapshot and screenshot commands.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- A passing Storybook drive does not verify the Forge iframe or a Confluence save.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-conf-app` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [View a diagram](./view-diagram.md) covers the macro header a reader sees for a Mermaid diagram: title, Edit, Source, Copy for AI, and Fullscreen.
- [View source](./view-source.md) covers opening and closing the read-only diagram source panel.
- [Rename a diagram title](./rename-title.md) covers renaming from the viewer title without opening the editor.
- [Export an image](./export-image.md) covers the export workspace a user sees after choosing export.
- [Publish from the editor](./editor-publish.md) covers the editor toolbar title and the Publish button's enabled state.
