# Viewer Create guide

A **Create** button in the viewer's top-actions row opens an 8-second, silent, looping video that
shows how to add another diagram to a Confluence page: Edit → click where it goes → type `/` and
the macro name → pick the macro. The video ends as the macro editor opens; the editor takes over
from there.

```
GenericViewer [Create] ─openCreateGuide()─► openModal({ resource: 'main', size: 'medium', title: '',
     ▲                                          context: { macroMode: 'create-guide', createGuideVariant } })
     │                                                   │
     │ onClose(payload) → create_guide_closed            ▼
     └──────────────── view.close({ method }) ◄── forgeIndex → mountCreateGuideModal → CreateGuideModal.vue
```

## When the button shows

All of: Lite app (`forgeGlobal.isLite`) · Forge flag `create-guide-enabled` (or a dev build) ·
the user can edit · the diagram type has a guide · not in Fullscreen.

| Diagram type | Guide | Query shown |
|---|---|---|
| Sequence, Mermaid, PlantUML, Markdown | `zenuml` | `/zenuml` → Diagram (Mermaid, PlantUML & ZenUML) Lite |
| Graph | `graph` | `/graph` → Graph (DrawIO) Lite |
| OpenAPI | `api` | `/openapi` → OpenAPI / Swagger Lite |

The videos name the **Lite** macros, so Full, Diagramly and AsyncAPI need their own renders before
the button can show there.

The action row normally hides until hover. When Create is present the row stays visible and only
its other buttons wait for hover, so Create can be discovered at rest.

## Why a Forge modal, why these sizes, why the guide closes itself

Measured on lite-stg, 2026-10-02 (1280 × 800 browser):

- A viewer iframe cannot draw outside its own box, so the guide needs Confluence's modal, like
  Fullscreen.
- `size: 'medium'` is a 600 × 520 box 60px from the top. The videos are 1200 × 1040 — exactly 2× —
  so they fill it with no letterbox.
- With `title: ''` Confluence draws no header and no close button. With a title it adds a ~70px
  header with its own X.
- Confluence closes the modal on a blanket click, or on Escape while focus is on its dialog
  element. Once focus is inside our iframe its Escape no longer works, so `CreateGuideModal` handles
  Escape itself and has its own close button (shown on hover or Tab focus; always on touch).
- Muted video autoplays in the modal iframe without user activation, even though the iframe's
  `allow` attribute omits `autoplay` (headless Chrome 154). The CSP allows `media-src 'self'`, so
  the videos ship in `public/video/`. Safari and Firefox were not tested.
- The untitled dialog has no accessible name; the guide's `<main>` carries a description instead.

## Analytics

`create_guide_impression` (button shown, once per viewer) → `create_guide_opened` →
`create_guide_closed` (`create_guide_close_method`: `button` | `escape` | `host`,
`create_guide_watched_ms`) · `create_guide_open_failed` (`failure_reason`).

## Regenerating the videos

The videos are rendered from a Remotion project that currently lives outside this repo
(`~/.codex/visualizations/2026/09/29/01a0eaf9-fa0c-7282-b2a2-cf4bf5eae91a/zenuml-creation-guide`,
commit `ee04043`). Its `storyboard.md` holds the frame timeline and the evidence behind every UI
detail. Render:

```bash
npx remotion render src/remotion.ts CreationGuide      ../public/video/create-guide-zenuml.mp4 --codec=h264 --crf=26 --pixel-format=yuv420p --muted
npx remotion render src/remotion.ts GraphCreationGuide ../public/video/create-guide-graph.mp4  --codec=h264 --crf=26 --pixel-format=yuv420p --muted
npx remotion render src/remotion.ts ApiCreationGuide   ../public/video/create-guide-api.mp4    --codec=h264 --crf=26 --pixel-format=yuv420p --muted
```

With `prefers-reduced-motion: reduce` the guide shows a still at 5 s (the typed query with the
target macro highlighted) instead of playing.
