# PR #1306 evidence: Open in Diagramly.ai from the MCP Apps view

- **BEFORE:** `170198192`, main after #1305 (Copy, Download, Save to Confluence; no Open button). The BEFORE toolbar image is #1305's AFTER capture (`pr-1305/after-toolbar.png`, commit `7fbbda684`), whose toolbar code equals `170198192`.
- **AFTER:** `79c15d7b9` (#1306 head).
- **Host:** claude.ai web, Chrome, desktop width, 2026-11-27.
- **Where it was served from:** the view came from the PR preview `https://conf-stg-lite-pr.zenuml.com` (bundle `view-DE__c00q.js`, deployed by PR validation run 45965969494), through a claude.ai connector to `https://conf-stg-lite-pr.zenuml.com/mcp`. The link opened `https://staging.diagramly.ai`, which serves ZenUml/diagramly.ai#1044's `/import` page.
- **Input:** a Mermaid flowchart titled "Diagramly test 2026-11-27 0832" (`flowchart TD; A[Start] --> B{Ready?}; B -->|yes| C[Ship]; B -->|no| A`); then a ZenUML sequence and a minimal OpenAPI 3.0 spec.

| File | What it shows |
|---|---|
| `after-toolbar.png` | Toolbar after: Copy, Download, Save to Confluence, Open in Diagramly.ai (box with arrow), zoom, fullscreen. |
| `open-link-dialog.png` | Clicking Open: claude.ai's own "Open external link" dialog with `https://staging.diagramly.ai/import#v1.<payload>` (about 249 characters). |
| `diagramly-sign-in.png` | Not signed in: Diagramly sent the tab to its sign-in page with `redirectTo=/import?resume=1`. The `#v1…` fragment was gone from the address bar (read from the tab; the address bar is not in this crop). |
| `diagramly-imported.png` | After a person signed in: `/diagrams/2458bd93-…` opened as a private diagram titled "Diagramly test 2026-11-27 0832", noted "Imported from ZenUML", with the source exactly as rendered. |
| `diagramly-one-copy.png` | After a reload and a second visit to `/import?resume=1`: still one diagram with that title. |
| `openapi-no-button.png` | A ZenUML sequence (top: has the Open button) and an OpenAPI spec (bottom: no Open button). The ZenUML view shows 20% zoom; see Limits. |

Screenshots are cropped to the relevant region; account names, email and chat lists are removed.

Limits and oddities:
- A person signed in to Diagramly staging; the test browser did not.
- The ZenUML diagram also opened in Diagramly (`/diagrams/96043876-…`, tagged ZenUML); that page isn't in this bundle.
- After the ZenUML Open click, that view in claude.ai showed 20% zoom (the crop). Cause not investigated; the fit code predates this PR.
- The ZenUML view's title strip stayed empty although the result had a title; Diagramly named the diagram by it.
- Signed-in-first path (already signed in when the link opens) not exercised.
