# Export an image

Export an image shows the export workspace: a preview, and tools to close, copy, or download the image. The Storybook story opens that workspace on a captured preview.

## Sub-features

- `export-open` shows the workspace named `Export image`.
- `export-tools` shows Close export, Copy image, and Download image.
- `export-download-enabled` leaves Download image enabled on the initial preview.

## How to get to it (user POV)

- In the editor or viewer, choose the export action. The workspace replaces the diagram with a preview and an export toolbar.
- In the Storybook stand-in, open story `modal-exportmodal--initial` (`Modal/ExportModal`, export `Initial`). The story renders the workspace already open.

## Driving it with control-conf-app

Preconditions:

- `doctor` reports a live Storybook and `storyIndexReady: true`.

- **Open the workspace.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser open-story modal-exportmodal--initial` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --selector '[aria-label="Export image"]'`. A region named `Export image` is present.
- **Check the tools.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser query --role button --name "Download image"`. `found` is true and `disabled` is false. Close export and Copy image are buttons with those accessible names.
- **Proof.** Run `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser snapshot --feature export-image --path .cursor/skills/verify-conf-app/artifacts/export-image/workspace.aria.txt` and `node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser screenshot --feature export-image --path .cursor/skills/verify-conf-app/artifacts/export-image/workspace.png`. The artifacts show `Export image` and `Download image`.

## Gotchas

- This story starts inside the workspace. It does not prove the viewer or editor control that opens export on a Confluence page.
- Do not click Download image unless the recipe is about the file that download produces. The initial proof is that the control is present and enabled.
- The preview is captured inside Storybook. It is not a Confluence attachment.
