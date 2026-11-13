# View a diagram

View a diagram shows a reader the macro header for a saved Mermaid diagram: the title, and, after the pointer is over the diagram, Edit, Source, Copy for AI, and Fullscreen.

## Sub-features

- `view-title` shows the diagram title without a hover.
- `view-actions` reveals Edit, Source, Copy for AI, and Fullscreen after hover.
- `view-edit-enabled` leaves Edit enabled for a diagram the story marks editable.

## How to get to it (user POV)

- On a Confluence page, read a ZenUML Mermaid macro. The title is in the macro header. Move the pointer over the diagram to reveal Edit, Source, Copy for AI, and Fullscreen.
- In the Storybook stand-in, open story `viewer-genericviewer--default` (`Viewer/GenericViewer`, export `Default`). The seeded title is `Login flow`.

## Driving it with control-conf-app

Preconditions:

- `doctor` reports a live Storybook and `storyIndexReady: true`.
- The browser session is `conf-app-verify`.

- **Open the macro.** Open the default viewer story. Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser open-story viewer-genericviewer--default` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --testid viewer-title-rename`. The title control's accessible name is `Rename diagram: Login flow` and its text is `Login flow`.
- **Read the title.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser text --testid viewer-title-rename`. The returned text contains `Login flow`.
- **Reveal actions.** Move the pointer over the diagram. Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser hover --selector .viewer-surface` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait 400`.
- **Check Edit.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser query --role button --name Edit`. `found` is true, `disabled` is false, and `opacity` is `1`.
- **Proof.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser snapshot --feature view-diagram --path .cursor/skills/verify-conf-app/artifacts/view-diagram/header.aria.txt` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser screenshot --feature view-diagram --path .cursor/skills/verify-conf-app/artifacts/view-diagram/header.png`. The artifacts show `Login flow` and an Edit control.

## Gotchas

- Edit, Source, Copy for AI, and Fullscreen stay at opacity 0 until `.viewer-surface` is hovered. A snapshot taken before the hover does not prove those actions.
- The title's accessible name is `Rename diagram: Login flow`. Asserting only the accessible name can pass while the visible text is wrong. Read the text as well.
- This story stubs `@forge/bridge` and seeds the store. It does not load a Confluence page. A Confluence drive needs `confluence open --url` with a staging `/wiki/` URL and is a separate entry point.
- Do not click Edit in this recipe. Edit opens the editor modal, which this story does not prove.
- The accessibility snapshot can include browser-chrome controls that are not part of the macro. Assert `Login flow`, `Edit`, `Source`, `Copy for AI`, and `Fullscreen` by name.
