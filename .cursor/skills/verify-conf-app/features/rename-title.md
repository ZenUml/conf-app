# Rename a diagram title

Rename a diagram title lets a reader change the title from the macro header. Enter commits the new title and the header shows it again. The Storybook story answers the save with an in-memory stub.

## Sub-features

- `rename-open` turns the title into a text field.
- `rename-commit` shows the new title on the header button after Enter.
- `rename-stub` waits through the story's artificial save delay before the button returns.

## How to get to it (user POV)

- On a Confluence page, choose the diagram title, type a new title, and press Enter. The header shows the new title.
- In the Storybook stand-in, open story `viewer-genericviewer--title-rename` (`TitleRename`). The seeded title is `Login flow`. The story stubs the custom-content read and write and waits about 700ms before the write resolves.

## Driving it with control-conf-app

Preconditions:

- `doctor` reports a live Storybook and `storyIndexReady: true`.
- No other story is being driven in this browser session.

- **Open the title.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser open-story viewer-genericviewer--title-rename` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --testid viewer-title-rename`. The title text is `Login flow`.
- **Start renaming.** Choose the title. Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser click --testid viewer-title-rename` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --testid viewer-title-input`. The field's accessible name is `Diagram title` and its value is `Login flow`.
- **Commit a new title.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser fill --testid viewer-title-input --value "Checkout flow"` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser press Enter`. Wait until the title button returns: `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --testid viewer-title-rename --timeout 5000`. Its text is `Checkout flow`.
- **Proof.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser text --testid viewer-title-rename`, then `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser screenshot --feature rename-title --path .cursor/skills/verify-conf-app/artifacts/rename-title/renamed.png`. The text and the screenshot show `Checkout flow`.

## Gotchas

- The title button is the control. Its accessible name is `Rename diagram: Login flow` before the rename and `Rename diagram: Checkout flow` after it. Assert the visible text.
- The story's write stub delays about 700ms and then returns the in-memory document. A returned title is not a Confluence custom-content version.
- A blank title is refused. Do not clear the field unless the recipe is testing that refusal.
- Pressing Enter while the field is absent types into the page. Wait for `viewer-title-input` first.
