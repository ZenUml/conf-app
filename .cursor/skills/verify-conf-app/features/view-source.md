# View source

View source opens a read-only panel with the diagram text. A reader can open it, read the source, and close it without changing the diagram.

## Sub-features

- `source-open` opens the panel from the Source button.
- `source-body` shows the Mermaid source for the seeded login diagram.
- `source-close` dismisses the panel.

## How to get to it (user POV)

- On a Confluence page, hover a text-DSL macro and choose Source.
- In the Storybook stand-in, open story `viewer-genericviewer--default`, hover the diagram, and choose Source. The seeded source contains `POST /login`.

## Driving it with control-conf-app

Preconditions:

- `doctor` reports a live Storybook and `storyIndexReady: true`.
- Story `viewer-genericviewer--default` is open and `.viewer-surface` has been hovered.

- **Open source.** Choose Source. Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser click --role button --name Source` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --testid view-source-panel`. A dialog appears whose heading is `Diagram source · Mermaid`.
- **Read the source.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser text --testid view-source-code`. The text contains `POST /login` and `200 OK`.
- **Close the panel.** Choose Close source panel. Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser click --role button --name "Close source panel"` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser eval "document.querySelector('[data-testid=view-source-panel]') ? 'present' : 'absent'"`. The result is `absent`.
- **Proof.** While the panel is open, run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser snapshot --feature view-source --path .cursor/skills/verify-conf-app/artifacts/view-source/panel.aria.txt` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser screenshot --feature view-source --path .cursor/skills/verify-conf-app/artifacts/view-source/panel.png`. The artifacts show the heading and `POST /login`.

## Gotchas

- Source is opacity 0 until `.viewer-surface` is hovered. Clicking it before the hover misses the control.
- The button's accessible name is `Source`. Its tooltip title is `View source`. Query the accessible name.
- The panel is read-only in the story. Closing it is not evidence that Confluence storage was left unchanged, because this stand-in never wrote Confluence.
