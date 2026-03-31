# Implementation Plan: Local Test Viewer + Enhanced Export

## Overview

Build a standalone local test page that simulates the Confluence Viewer (no AP/Confluence required),
and add an enhanced export image modal with theme, background, note, arrow, and watermark support.

### Architecture Decision: v1 → v2 Transition

**v1 (this branch)**: Ship current features as-is. CSS/HTML overlays for preview, Canvas 2D API for export.
Covers core use case (theme, background, note, arrow, watermark). Production-polished UI.

**v2 (follow-up)**: Rewrite rendering layer to SVG-first. One rendering pipeline for both preview and export.
Drag-based interactions, grip handles, selection model. Keep sidebar UI unchanged.

---

## Stage 1: Local Test Viewer Page
**Goal**: `test-viewer.html` accessible at `http://localhost:8080/test-viewer.html`
**Status**: Complete ✓

### Files created
- `test-viewer.html` — HTML entry point (no Atlassian Connect scripts needed, MockAp handles local dev)
- `src/test-viewer.ts` — TS entry that initializes DiagramPortal in display mode with mock ZenUML sequence diagram

### Success Criteria
- Page loads at `http://localhost:8080/test-viewer.html` without errors
- Viewer header is visible with: Fullscreen, Edit, Export, Copy Code buttons
- A ZenUML sequence diagram renders in the content area
- No Confluence connection required

### Implementation Notes
- `AP.ts` already auto-falls back to `MockAp` when `window.AP.confluence` is not present
- `MockAp` already has mocked custom content for sequence diagrams (`custom-content-by-id-v1-diagram-sequence.json`)
- The existing `sequence-viewer.ts` boot sequence (`initializeCriticalPath` → `loadHeavyComponents`) can be
  reused directly — just copy the pattern with `displayMode` forced to true
- Set `window.__isDisplayMode = true` or pass a URL param `?displayMode=true` to simulate view mode
- Use a hardcoded mock diagram body if MockAp doesn't load correctly

---

## Stage 2: Enhanced Export Modal — Core UI
**Goal**: Replace the "Export" button with a modal that has 5 panels
**Status**: Complete ✓

### Files to create
- `src/components/ExportModal/ExportModal.vue` — Main modal component
- `src/components/ExportModal/useExportModal.ts` — Composable for export logic

### UI Layout (frontend-design aesthetic: "Design Studio" — dark sidebar panel, clean, professional)

The modal opens as a full-width bottom drawer or right-side panel. Two columns:
- Left: live preview of the diagram with overlays applied
- Right: settings panels (accordion or tabs)

### Settings Panels

#### 2a. Theme
- Options: Light (white bg, dark text), Dark (slate bg, light text), Blueprint (navy bg, white lines), Auto (match current)
- UI: Icon cards with preview swatches

#### 2b. Background
- Options: Transparent (checkerboard pattern indicator), White, Custom color picker, Gradient presets (soft gray, warm cream, cool blue)
- UI: Color swatches + custom color input

#### 2c. Note (Text Annotation)
- A text input for a caption/annotation string
- Position: Top-left, Top-right, Bottom-left, Bottom-center, Bottom-right
- Font size slider: 10–24px
- Text color picker

#### 2d. Arrow
- Toggle: Show/hide arrow overlay
- Arrow type: Single-head, Double-head, Curved
- Manually position by clicking on the preview (record two points: start and end)
- Color picker + thickness slider
- Label text for the arrow

#### 2e. Watermark
- Toggle: Show/hide watermark
- Text input (e.g., "Confidential", "Draft", "© Company")
- Opacity slider: 5–50%
- Size slider: 12–48px
- Position: Diagonal (center), Bottom-right corner
- Color: dark gray or custom

### Success Criteria
- Modal opens when "Export" button is clicked
- Live preview updates when settings change
- Download button in modal exports the image with all overlays applied

---

## Stage 3: Enhanced Export Modal — Export Engine
**Goal**: Canvas-based export that applies all overlays to the captured diagram image
**Status**: Complete ✓

### Implementation Notes
- Step 1: Use existing `html-to-image` (`toBlob`) to capture the `.screen-capture-content` element
- Step 2: Draw the captured image onto a `<canvas>` element
- Step 3: Apply overlays in order: background → image → note → arrows → watermark
- Step 4: Export canvas as PNG via `canvas.toBlob()` + `saveAs`

### Theme Application
- Light/Dark: inject a CSS class onto the capture node before `toBlob`, remove after
- Blueprint: custom CSS class with navy background

### Arrow Drawing
- Use Canvas 2D API: `ctx.beginPath()`, `ctx.moveTo()`, `ctx.lineTo()`, arrowhead triangle
- Store arrow points as `{start: {x, y}, end: {x, y}}` in component state

### Watermark Drawing
```
ctx.save()
ctx.globalAlpha = opacity
ctx.font = `${size}px sans-serif`
ctx.fillStyle = color
ctx.rotate(-Math.PI / 4)  // diagonal
ctx.fillText(text, x, y)
ctx.restore()
```

---

## Stage 4: Integration into GenericViewer
**Goal**: Wire ExportModal into GenericViewer.vue
**Status**: Complete ✓

### Changes to `src/components/Viewer/GenericViewer.vue`
- Add `import ExportModal from '@/components/ExportModal/ExportModal.vue'`
- Add `showExportModal: false` to data
- Replace `@click="downloadPng"` on Export button with `@click="showExportModal = true"`
- Add `<ExportModal :visible="showExportModal" @close="showExportModal = false" />`
- Keep the old `downloadPng` method as fallback but expose it from ExportModal

---

## Stage 5: Fix Real Functionality Gaps
**Goal**: Make the export features actually work as users expect
**Status**: Complete ✓

### Issues to fix

#### 5a. Real diagram preview (highest priority)
- When ExportModal opens, capture `.screen-capture-content` via `html-to-image.toPng()` and show it as `<img>` in the preview pane
- Overlay note/arrow/watermark CSS on top of the real diagram image
- Add a "Refresh preview" button in case diagram changes after modal opens

#### 5b. Theme → background-color mapping (replaces broken CSS injection)
- Remove CSS class injection from `useExportEngine.ts`
- Map themes to background colors passed to `html-to-image`:
  - `auto` → `undefined` (transparent, let diagram background show)
  - `light` → `#ffffff`
  - `dark` → `#1e293b` (diagram renders on dark bg)
  - `blueprint` → `#0f172a`
- Update preview to reflect chosen theme as background color on the `<img>` wrapper

#### 5c. Arrow click-to-position on preview (interactive)
- Show crosshair cursor on preview when arrow is enabled
- First click = arrow start point (stored as % of preview width/height)
- Second click = arrow end point
- Render SVG arrow overlay connecting the two points
- In export engine, use stored % coordinates scaled to canvas dimensions

## Execution Order

1. Stage 1 first — establishes the local dev environment to test the export modal
2. Stage 2 — build ExportModal UI (static, no export logic yet), verify it looks right in local test viewer
3. Stage 3 — add the canvas export engine
4. Stage 4 — wire into GenericViewer

## Stage 6: Multi-Macro Export Support
**Goal**: Ensure export works for all macro types (Sequence, Mermaid, PlantUML, Graph/DrawIO, OpenAPI)
**Status**: Complete ✓ (no changes needed)

### Finding
All viewer components are wrapped by `GenericViewer.vue` which provides the `.screen-capture-content` class.
The export engine's `document.querySelector('.screen-capture-content')` already works universally across all diagram types.

---

## Stage 7: Fix Theme & Background Visual Feedback
**Goal**: Theme and background selection must produce visible changes in the preview
**Status**: Complete ✓

### Problem
Clicking theme cards or background swatches showed "nothing happens" because:
1. `previewCanvasStyle` always used `resolvedBgColor` (white) which overrode the theme color
2. No padding on `.preview-canvas-wrap`, so the background color was hidden behind the diagram image

### Fix
- `previewCanvasStyle`: use theme color as base background; only override with background swatch when it's explicitly non-white
- Add `padding: 16px` to `.preview-canvas-wrap` so theme/background color is visible as a frame around the diagram
- Fix export engine: when background is default (white), use theme color instead
- auto theme → `#f0f2f5` (light gray, distinguishable from light theme `#ffffff`)

### Success Criteria
- Clicking "Dark" theme shows dark (#1e293b) frame around diagram in preview
- Clicking "Warm" background shows warm (#fffbf0) frame in preview
- Exported PNG uses theme/background color as background behind diagram
- Auto theme shows a neutral light-gray frame (distinguishable from the diagram)

---

## Stage 8: UI Testing Report
**Goal**: Browser-automated test of each ExportModal feature, producing a visual report
**Status**: Complete ✓

### Steps
1. Open `http://localhost:8080/test-viewer.html` in browser
2. Click Export to open modal
3. For each feature: apply it, take a screenshot, note pass/fail
4. Features to test: Theme (all 4), Background (all 5 swatches), Note (text + position), Arrow (enable + click-to-place), Watermark (enable)
5. Click Download PNG and verify file exists and has overlays
6. Produce markdown report: `tests/export-modal-ui-test-report.md`

---

## Stage 9: UX Interaction Polish
**Goal**: Fix broken/confusing interaction flows in ExportModal
**Status**: Complete ✓

### Issues Fixed

#### 9a. Export button loading state
- Added `isExporting: false` data flag
- `handleExport()` wrapped in guard + try/finally: sets `isExporting = true` before async work, resets in `finally`
- Button shows spinner + "Exporting…" text while busy; disabled with `opacity: 0.7; cursor: not-allowed`

#### 9b. Arrow 3rd-click reset has no affordance
- When `arrowClickCount === 2` (arrow fully placed), `arrow-click-hint` was hidden — no indication clicking again wipes the arrow
- Added `v-else-if="arrow.enabled && arrowClickCount === 2"` hint: "Click again to reset arrow"
- Styled with `.arrow-click-hint--reset` (muted gray background) to distinguish from action hints (blue)

#### 9c. First arrow click registers invisibly
- Click 1 set both start/end to same point → zero-length `<line>` renders nothing
- Added `<circle v-if="arrowClickCount === 1">` dot at start coordinates in SVG overlay
- `<line>` now has `v-if="arrowClickCount === 2"` to only render once both points are set

---

## Stage 10: markerjs3-Inspired Improvements
**Goal**: Learn from markerjs3 architecture and adopt key rendering/interaction patterns
**Status**: Complete ✓

### Patterns Adopted

#### 10a. Path-based arrowheads (replaces SVG `<marker>` elements)
- Removed `<defs>` with `<marker>` elements from arrow SVG overlay
- Arrowheads now computed as `<path>` polygons using trigonometry (same algorithm as markerjs3's ArrowMarker)
- Arrow size proportional to thickness: `arrowHeight = 10 + thickness * 2`, `arrowWidth = min(max(5, thickness * 2), thickness + 5)`
- Dip factor 0.7 for refined diamond shape; `stroke-linejoin: round` for smooth corners
- Both preview SVG and export canvas use identical formula

#### 10b. Note text drop shadow for legibility
- Preview: dual `text-shadow` (dark drop + white glow) on `.preview-note`
- Export: canvas `shadowColor/shadowBlur/shadowOffsetY` wrapped in `ctx.save()/restore()`
- Inspired by markerjs3's SVG filter pattern (feDropShadow on all markers)

#### 10c. Draggable note overlay
- Placed notes can be repositioned by dragging (pointer events: `pointerdown → pointermove → pointerup`)
- Uses `setPointerCapture` for reliable tracking beyond element bounds
- Coordinates clamped to 0–1 normalized range
- CSS: `.preview-note.draggable` overrides `pointer-events: none` with `cursor: grab/grabbing`
- Inspired by markerjs3's editor state machine (`new → creating → select → move`)

---

## v1 Definition of Done

- [x] `test-viewer.html` renders a real ZenUML diagram with the viewer header
- [x] Export button opens ExportModal
- [x] All 5 settings panels work (theme, background, note, arrow, watermark)
- [x] Live preview shows overlays in real-time (with Refresh button)
- [x] Download produces a PNG with all overlays applied (verified: 240KB PNG with arrow + watermark + note overlays)
- [x] `pnpm test:unit` passes (158 tests, 0 regressions)
- [x] Integration test on zenuml-stg.atlassian.net (conf-stg-full.zenuml.com/sequence-viewer — all 5 panels verified, PNG download confirmed)

---

# v2 Plan: SVG-First Rendering & Interaction Rewrite

Reference: `docs/markerjs3-feature-analysis.md`

## Motivation

v1 has two rendering pipelines (CSS preview + Canvas export) that must be kept in sync.
Every new overlay type requires implementing rendering twice. Drag-based interactions and
grip handles are difficult to retrofit onto the current HTML div overlay approach.

## What to Keep from v1

- Sidebar UI shell (`export-sidebar`, all settings sections, CSS design polish)
- Theme/background selection logic and `previewCanvasStyle` computed
- Diagram capture pipeline (`html-to-image` → blob)
- `useExportEngine.ts` concept (capture → composite → download)
- Test viewer page (`test-viewer.html`, `src/test-viewer.ts`)
- All unit tests

## What to Rewrite

- Preview overlay rendering (HTML divs → SVG layer)
- Export compositing (Canvas 2D drawing → SVG rasterization)
- Interaction model (click-to-place → drag-based with grip handles)
- Component structure (1400-line monolith → composable sub-components)

---

## Stage 11: Extract Sidebar Settings Component
**Goal**: Split ExportModal into shell + sidebar + preview sub-components
**Status**: Not Started

### Tasks
- Extract `ExportSidebar.vue` — all settings sections (theme, background, note, arrow, watermark)
- Extract `ExportPreview.vue` — preview pane with overlay rendering
- `ExportModal.vue` becomes a thin shell: layout, open/close, export action
- Communicate via props/events or a shared composable (`useExportState.ts`)

### Success Criteria
- Same visual behavior as before
- Each component < 400 lines
- All 158 tests still pass

---

## Stage 12: SVG Overlay Layer
**Goal**: Replace HTML div overlays with a single SVG layer for all annotations
**Status**: Not Started

### Architecture
```
<div class="preview-canvas">
  <img :src="previewDataUrl" />          <!-- Captured diagram -->
  <svg class="overlay-layer" viewBox="0 0 1 1" preserveAspectRatio="none">
    <!-- All annotations rendered as SVG -->
    <g class="note-overlay">
      <text>...</text>                    <!-- Note text with filter -->
    </g>
    <g class="arrow-overlay">
      <line ... />                        <!-- Arrow line -->
      <path ... />                        <!-- Arrowhead polygon -->
    </g>
    <g class="watermark-overlay">
      <text>...</text>                    <!-- Watermark text -->
    </g>
  </svg>
</div>
```

### Tasks
- Create `OverlayLayer.vue` — renders all annotations as SVG
- Note: `<text>` with SVG `<filter>` (feDropShadow) for legibility
- Arrow: `<line>` + `<path>` terminators (already SVG in v1)
- Watermark: `<text>` with opacity and rotation via SVG `transform`
- Add SVG `<defs>` section for shared filters (drop shadow, glow)

### Success Criteria
- Preview looks identical to v1
- All overlays are pure SVG (no HTML divs for note/watermark)
- SVG layer has `viewBox="0 0 1 1"` with normalized coordinates

---

## Stage 13: SVG-to-Canvas Export Pipeline
**Goal**: Replace Canvas 2D drawing code with SVG rasterization
**Status**: Not Started

### Architecture (markerjs3 Renderer pattern)
```
1. Capture diagram → blob (existing html-to-image)
2. Draw diagram blob on Canvas
3. Clone SVG overlay layer innerHTML
4. Convert SVG → Blob → ObjectURL → Image
5. Draw SVG image on Canvas (on top of diagram)
6. canvas.toBlob() → saveAs()
```

### Tasks
- Rewrite `useExportEngine.ts` to use SVG rasterization instead of `ctx.fillText` / `ctx.beginPath`
- Remove all Canvas 2D drawing code for note, arrow, watermark
- Handle SVG-to-Canvas conversion with proper font embedding
- Support `naturalSize` export (render at diagram's native resolution, not viewport)

### Success Criteria
- Exported PNG is pixel-identical to preview (same SVG renders both)
- No more `ctx.fillText`, `ctx.fillStyle`, `ctx.rotate` etc. in export code
- Export engine is < 80 lines

---

## Stage 14: Drag-to-Draw Arrow Interaction
**Goal**: Replace click-click arrow with drag gesture (markerjs3 pattern)
**Status**: Not Started

### Interaction Design
```
State machine: idle → creating → placed → (moving | resizing)

idle:
  pointerdown on canvas → set start point, enter 'creating'

creating:
  pointermove → update end point, show arrow in real-time
  pointerup → finish arrow, enter 'placed'

placed:
  click on arrow → select, show grips, enter 'selected'
  click on empty → deselect

selected:
  drag grip → resize (move that endpoint)
  drag line body → move entire arrow
  Delete key → remove arrow
```

### Tasks
- Implement pointer event state machine in `OverlayLayer.vue`
- Render grip handles (SVG circles) at arrow endpoints when selected
- Grip hit area: visible 6px circle + invisible 12px circle for easier clicking
- Support moving entire arrow by dragging the line body
- Add keyboard support: Delete to remove, Escape to deselect

### Success Criteria
- Arrow creation is drag-based (press → drag → release)
- Arrow shows in real-time during drag
- After placement: grips appear, endpoints independently draggable
- Line body draggable to move entire arrow

---

## Stage 15: Draggable Note with In-Place Editing
**Goal**: Notes are SVG text elements that can be dragged and edited in-place
**Status**: Not Started

### Interaction Design
```
Click "Place note" → click on preview → note appears at click point
Drag note → reposition
Double-click note → enter edit mode (contenteditable or text input overlay)
Escape/click away → exit edit mode
```

### Tasks
- Note rendered as SVG `<text>` in the overlay layer
- Drag-to-reposition via pointer events (already partially done in v1)
- Double-click to edit: overlay a positioned `<input>` on top of the SVG text
- Sync edited text back to the note state
- Support multi-line text with SVG `<tspan>` elements

### Success Criteria
- Note is draggable after placement (already done in v1)
- Double-click opens an editable text field at the note position
- Editing updates both preview and export

---

## Stage 16: Callout Marker (Text + Pointer)
**Goal**: New annotation type combining text box with a speech-bubble pointer
**Status**: Not Started

### Design
- A rounded rectangle with text inside + a triangular pointer extending to a tip point
- User drags to create the text box, then adjusts the tip position
- Replaces the separate note + arrow workflow for the "label this part" use case

### Tasks
- Create `CalloutMarker` component rendering SVG `<path>` (rounded rect + pointer)
- Text inside the callout uses `<text>` with word wrapping (`<tspan>`)
- Tip position stored as normalized coordinates, draggable via grip handle
- Add "Callout" option to the Note section in sidebar (alongside "Click to place")

### Success Criteria
- Callout renders as a speech bubble with text + pointer
- Pointer tip is independently draggable
- Text is editable (double-click)
- Exports correctly via SVG rasterization

---

## Stage 17: Selection Model & Delete
**Goal**: Unified selection for all annotation types
**Status**: Not Started

### Design
- Click an annotation → selected (grips appear, properties shown in sidebar)
- Click empty space → deselect all
- Delete key or trash button → remove selected annotation
- Only one annotation selected at a time (single selection)

### Tasks
- Add `selectedAnnotation: 'note' | 'arrow' | 'watermark' | 'callout' | null` state
- When selected, show grips and highlight the annotation
- Sidebar dynamically shows properties for the selected type
- Keyboard: Delete removes, Escape deselects

### Success Criteria
- Click any annotation to select it
- Selected annotation shows grips and sidebar updates
- Delete removes the selected annotation
- Click empty space deselects

---

## v2 Definition of Done

- [ ] Component split: ExportModal < 200 lines, ExportSidebar, ExportPreview, OverlayLayer
- [ ] All annotations render as SVG (zero HTML div overlays)
- [ ] Export uses SVG rasterization (zero Canvas 2D drawing code)
- [ ] Arrow: drag-to-draw, grip handles at endpoints, draggable line body
- [ ] Note: draggable, in-place editable (double-click)
- [ ] Callout: text box + pointer, tip draggable
- [ ] Selection model: click to select, Delete to remove, Escape to deselect
- [ ] Preview and export are pixel-identical (same SVG renders both)
- [ ] All existing unit tests pass + new tests for interaction model
- [ ] Sidebar UI unchanged (all v1 polish preserved)
