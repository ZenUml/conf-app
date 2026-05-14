# Graph (DrawIO) multi-page test fixtures

Reference Confluence pages used to verify the multi-page DrawIO fix in
`v2026.05.140705-lite` ([PR #82](https://github.com/ZenUml/conf-app/pull/82),
[issue #81](https://github.com/ZenUml/conf-app/issues/81)). Reuse these for any future
regression testing of the Graph macro — they cover save, view, page-nav,
wide-graph fit, and backward compatibility.

Don't rename, move, or delete without updating this doc.

## Production (`zenuml.atlassian.net`)

### 1. Legacy single-page record (pre-fix data)

> Used for: backward-compat regression — confirm raw `<mxGraphModel>` records
> still render under the new `GraphViewer`-based viewer.

| Field | Value |
|---|---|
| Page | "ZenUML add-on Demo Page" — `Demo2 - Graph` section |
| Page URL | <https://zenuml.atlassian.net/wiki/spaces/IN/pages/2031026182/ZenUML+add-on+Demo+Page> |
| Page ID | `2031026182` |
| Custom content ID | `2030862338` |
| Storage shape | Raw `<mxGraphModel dx="1426" …>` — **no `<mxfile>` wrapper** |
| Last edited | 2024-10-11 (saved by the pre-fix `toGraphModel()` flattening path) |
| What you should see | Flowchart with 6 nodes: "Lamp doesn't work" → "Lamp plugged in?" → "Plug in lamp" / "Bulb burned out?" → "Replace Bulb" / "Repair Lamp" |
| Page-nav buttons in pill | Should NOT be visible (auto-hide on single-page) |

Verify storage shape:

```js
const r = await fetch('/wiki/rest/api/content/2030862338?expand=body.raw', { credentials: 'include' });
const raw = JSON.parse((await r.json()).body.raw.value).graphXml;
console.log(raw.startsWith('<mxGraphModel'));  // true → legacy format
```

### 2. New multi-page record (post-fix data)

> Used for: save round-trip, viewer page-nav in the floating pill,
> Page-1 → Page-2 navigation.

| Field | Value |
|---|---|
| Page title | "Smoke Test lite 2026-05-14 19:02 (Graph)" |
| Page URL | <https://zenuml.atlassian.net/wiki/spaces/ZEN/pages/2790555675/Smoke+Test+lite+2026-05-14+19+02+Graph> |
| Page ID | `2790555675` |
| Custom content ID | `2790817837` |
| Location | PVT / 2026 / 2026-05 (parent ancestry) |
| Storage shape | `<mxfile>` with 2 `<diagram>` nodes |
| Page-1 content | Rectangle |
| Page-2 content | Text label "PVT page 2" |
| What you should see | Pill on hover contains `‹` / `1 / 2` / `›` before Copy / Export / Versions / Copy link. Clicking `›` switches the SVG to "PVT page 2"; indicator → `2 / 2`, `‹` enabled, `›` disabled. |

Verify storage shape:

```js
const r = await fetch('/wiki/rest/api/content/2790817837?expand=body.raw', { credentials: 'include' });
const raw = JSON.parse((await r.json()).body.raw.value).graphXml;
console.log(raw.includes('<mxfile'));                       // true → new format
console.log((raw.match(/<diagram /g) || []).length);        // 2 → two pages
console.log(/PVT page 2/.test(raw));                        // true → Page-2 text persisted
```

## Development (`lite-dev.atlassian.net`)

### 3. Wide-graph fit fixture (ZEN-1168 regression)

> Used for: confirming wide diagrams (`bounds.width >> iframe.width`) fit the
> container instead of overflowing.

| Field | Value |
|---|---|
| Page title | "ZEN-1168 Wide Graph Validation 2026-05-13-11-10-13" |
| Page URL | <https://lite-dev.atlassian.net/wiki/spaces/SD/pages/5472257/ZEN-1168+Wide+Graph+Validation+2026-05-13-11-10-13> |
| Page ID | `5472257` |
| Custom content ID | `5472273` (graph), then converted to multi-page during PR #82 validation |
| Diagram natural width | ~2331px |
| Iframe container width | ~760px |
| What you should see | All 4 nodes visible: LEFT → MIDDLE-LEFT → MIDDLE-RIGHT → RIGHT EDGE — scaled down to fit, no horizontal clipping |
| Storage shape (current) | `<mxfile>` with 2 `<diagram>` nodes (was raw `<mxGraphModel>` before PR #82) |

This page is on the **dev** site (private to the developer who set up the tunnel).
Reproduce on any site by creating a new Graph macro and pasting in a wide diagram
— the geometry check is `container.offsetWidth ≈ iframe.width` and
`svg.offsetWidth ≤ container.offsetWidth + 2 * border`.

## Verification matrix

What each fixture is designed to confirm at a glance:

| Behaviour | Fixture 1 (legacy) | Fixture 2 (new multi-page) | Fixture 3 (wide) |
|---|---|---|---|
| New `GraphViewer` decodes legacy `<mxGraphModel>` | ✓ |  |  |
| New code persists full `<mxfile>` on save |  | ✓ |  |
| Pill shows `‹ X / Y ›` only when multi-page |  | ✓ |  |
| `selectPage()` wired to Next/Previous |  | ✓ |  |
| Single-page → no page-nav (auto-hide) | ✓ |  |  |
| Wide diagrams scale down to container | (any) | (any) | ✓ |

## Notes

- All three fixtures live in spaces where the **Lite** variant is installed
  (`com.zenuml.confluence-addon-lite`). Adapt content-type strings and version
  labels accordingly if testing Full or Diagramly.
- Fixture 1 must never be edited via the new editor — once republished, it
  upgrades to the `<mxfile>` shape and stops being a backward-compat fixture.
  If you need to test "legacy still renders" after a future change, find a
  different pre-2026-05-14 Graph record (CQL:
  `type = "ac:com.zenuml.confluence-addon-lite:zenuml-content-graph" AND created < "2026-05-14"`).
