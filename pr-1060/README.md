# PR 1060 evidence

Candidate: 6968a26b (branch claude/graph-icons-proxy). Base: f83e145b (#1055).
Storybook (localhost, Chrome), stories `Viewer/ForgeGraphViewer`: "icons.diagrams.net icons through the backend proxy" and "icon proxy fails".
Fixture: synthetic graph with one style icon and one HTML-label `<img>`; the proxy answer is stubbed (`stubResponses.remote`), so the backend half is NOT covered here.

- 2-export-png-preview-both-icons.jpg: Export PNG preview, both icons present (style icon and label image).
- 3-proxy-fails-viewer-renders.jpg: stub answers 502; diagram still renders.
- 4-proxy-fails-png-refused.jpg: same story, Export PNG; capture refused ("graph icon proxy failed: http_502").

No BEFORE screenshot was captured on the base commit.

## Editor, tunnel and staging, 2026-11-05

All images use synthetic fixtures. Customer sample pages are not published.

Runtime code: `9b142da1`. Head `7615a14a` adds one code comment. The Publish run used the CI build on `lite-stg` from one of those two commits.

- 5, 6, 7: Storybook editor, stubbed proxy: icons shown, after a move, and proxy 502 (editor opens). The 7 fixture also has a URL that does not exist, so one broken image is expected there. Storybook has no Forge CSP.
- 8, 9: Forge Tunnel on `lite-dev`, synthetic macro: editor and viewer show the external icon (9 is cropped).
- 10, 11: CI-deployed `lite-stg`, editor, before and after moving the icon.
- 12: viewer after Publish and reload (cropped to the macro).
- 13: PNG attachment written by that Publish.

Publish result, read through REST: custom content version 1 to 2; saved `graphXml` keeps `image=https://icons.diagrams.net/...`, `data:image` count 0, icon geometry x=360 y=170.
