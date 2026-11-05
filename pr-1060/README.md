# PR 1060 evidence

Candidate: 6968a26b (branch claude/graph-icons-proxy). Base: f83e145b (#1055).
Storybook (localhost, Chrome), stories `Viewer/ForgeGraphViewer`: "icons.diagrams.net icons through the backend proxy" and "icon proxy fails".
Fixture: synthetic graph with one style icon and one HTML-label `<img>`; the proxy answer is stubbed (`stubResponses.remote`), so the backend half is NOT covered here.

- 2-export-png-preview-both-icons.jpg: Export PNG preview, both icons present (style icon and label image).
- 3-proxy-fails-viewer-renders.jpg: stub answers 502; diagram still renders.
- 4-proxy-fails-png-refused.jpg: same story, Export PNG; capture refused ("graph icon proxy failed: http_502").

No BEFORE screenshot was captured on the base commit.
