# Publish from the editor

Publish from the editor is the toolbar action that saves the diagram and leaves the editor. Publish stays disabled until the diagram has a title. With a title, the button is enabled. This map proves that enabled state. It does not click Publish.

## Sub-features

- `publish-disabled` keeps Publish disabled when the title is empty.
- `publish-enabled` enables Publish when the title is `Payment Flow`.
- `publish-title` shows that title in the toolbar text field.

## How to get to it (user POV)

- Open a diagram in the editor. The toolbar has the title field, the diagram-type tabs, and Publish on the right.
- With an empty title, Publish is disabled. Hovering it shows `Add a diagram title to publish`.
- With a title, Publish can be clicked. Clicking it is the save. This Storybook recipe does not click it.
- In the Storybook stand-in, the empty title is story `editor-diagram-header--sequence-no-title`. The titled diagram is story `editor-diagram-header--sequence-with-title`.

## Driving it with control-conf-app

Preconditions:

- `doctor` reports a live Storybook and `storyIndexReady: true`.

- **Open the titled editor.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser open-story editor-diagram-header--sequence-with-title` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --selector 'input[placeholder="Untitled diagram"]'`.
- **Read the title.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser value --selector 'input[placeholder="Untitled diagram"]'`. The value is `Payment Flow`.
- **Check Publish.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser query --role button --name Publish`. `found` is true and `disabled` is false.
- **Proof.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser screenshot --feature editor-publish --path .cursor/skills/verify-conf-app/artifacts/editor-publish/titled.png` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser snapshot --feature editor-publish --path .cursor/skills/verify-conf-app/artifacts/editor-publish/titled.aria.txt`. The artifacts show `Payment Flow` and Publish.
- **Empty title.** Open the other entry point. Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser open-story editor-diagram-header--sequence-no-title` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --selector 'button[aria-label="Publish"]'`. Query Publish again with `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser query --role button --name Publish`. `found` is true and `disabled` is true.

## Gotchas

- The title field has placeholder `Untitled diagram` and no accessible name. Do not invent an aria-label for it.
- Do not click Publish in this stand-in. The click calls the save handler. The story does not record a Confluence write, so a click cannot prove one.
- Prove the titled story before navigating to the empty-title story. The screenshot must show `Payment Flow`.
- Publish's accessible name stays `Publish` while it is disabled. `disabled: true` is the observation that matters.
