# markerjs3 Feature Analysis for ExportModal Integration

**Source**: https://markerjs.com + https://github.com/ailon/markerjs3
**Purpose**: Learn from markerjs3's UX patterns and adopt them in our ExportModal

---

## 1. Arrow Marker

### User's Point of View
- **Creation**: Select the arrow tool from the toolbar. Click and **drag** on the image — the arrow appears in real-time as you drag. Release to finish.
- **Selection**: Click an existing arrow to select it. Two **grip handles** (small blue circles) appear at the start and end points.
- **Repositioning**: Drag a grip handle to move that endpoint independently. Drag the line body to move the entire arrow without changing its angle or length.
- **Customization**: When selected, a secondary properties bar appears with color picker, stroke width, and arrow type (start/end/both/none).
- **Deselection**: Click empty space to deselect. Grips disappear.
- **Deletion**: Select the arrow, then click the trash icon or press Delete.

### Developer's Point of View
- **Class hierarchy**: `MarkerBase → LinearMarkerBase → LineMarker → ArrowMarker`
- **State**: `ArrowMarkerState { x1, y1, x2, y2, strokeColor, strokeWidth, arrowType: 'start'|'end'|'both'|'none' }`
- **Rendering**: SVG `<path>` elements — one for the line, two for arrowhead terminators (filled polygons computed with `atan2` trigonometry). NOT SVG `<marker>` elements.
- **Arrowhead sizing**: Proportional to stroke width — `arrowHeight = 10 + strokeWidth * 2`, `arrowWidth = min(max(5, strokeWidth * 2), strokeWidth + 5)`. A `dipFactor` of 0.7 creates a refined diamond shape.
- **Visual layers**: `selectorVisual` (invisible, wider stroke for hit detection) + `visibleVisual` (line + start/end terminators)
- **Editor state machine**: `new → creating → select → (move|resize)`. `pointerDown` sets start point, `pointerMove` updates end point, `pointerUp` finishes creation.
- **Grip system**: SVG circles at endpoints. Each grip has a visible circle + an invisible larger circle (2x radius) for easier clicking. Grips scale inversely with zoom level.

### Integration to Our Application
- **Replace click-click with drag-to-draw**: Currently our ExportModal uses two discrete clicks (click for start, click for end). Adopt markerjs3's drag gesture: `pointerdown` = start, `pointermove` = live preview, `pointerup` = finish.
- **Add endpoint grip handles**: After arrow placement, show two SVG circles at start/end. Each draggable independently via pointer events with `setPointerCapture`.
- **Adopt proportional arrowheads**: Already done in Stage 10 — we adopted markerjs3's trig-based arrowhead computation.
- **Move entire arrow**: Add hit detection on the line body. When dragged, translate both endpoints by the same delta.

---

## 2. Line Marker

### User's Point of View
- Same as Arrow but without arrowheads. A simple straight line.
- Available in the arrow tool dropdown (the `∨` chevron next to the arrow icon).
- Drag to draw, drag grips to reposition.

### Developer's Point of View
- **Class**: `LinearMarkerBase → LineMarker` (ArrowMarker extends this)
- **State**: `LinearMarkerBaseState { x1, y1, x2, y2, strokeColor, strokeWidth, strokeDasharray }`
- **Dash support**: `strokeDasharray` enables dashed/dotted lines (e.g., `"5,5"`)
- **Rendering**: Single SVG `<path>` with `M x1,y1 L x2,y2`

### Integration to Our Application
- Not currently needed — our arrow tool covers this use case. Could be added as an arrow type `'—'` (line without arrowheads) if users request it.

---

## 3. Curve Marker

### User's Point of View
- Draw a curved (bezier) line between two points.
- After creation, the curve shape can be adjusted by dragging control points.
- Available in the arrow/line tool dropdown.

### Developer's Point of View
- **Class**: `CurveMarker` extends `LinearMarkerBase`
- **State**: `CurveMarkerState { x1, y1, x2, y2, curveX, curveY }` — the control point
- **Rendering**: SVG `<path>` with `Q curveX,curveY` (quadratic bezier)
- **Editor**: Additional grip at the control point for adjusting curvature

### Integration to Our Application
- Our `⤷` curved arrow type uses a hardcoded bezier. Could be improved by allowing the user to drag a control point to adjust curvature, similar to markerjs3's approach.

---

## 4. Frame Marker (Rectangle Outline)

### User's Point of View
- Select the shape tool (rectangle icon). Drag to draw a rectangular outline.
- 8 resize grips appear (corners + midpoints). Drag any grip to resize.
- Rotation handle allows rotating the rectangle.
- Color, stroke width customizable.

### Developer's Point of View
- **Class**: `RectangularBoxMarkerBase → ShapeOutlineMarkerBase → FrameMarker`
- **State**: `{ left, top, width, height, rotationAngle, strokeColor, strokeWidth }`
- **Rendering**: SVG `<rect>` with stroke only (no fill)
- **8-grip system**: NW, N, NE, E, SE, S, SW, W positions. Each grip adjusts the bounding box dimensions.
- **Rotation**: A grip above the top-center, connected by a thin line. Dragging it rotates the entire marker around its center.

### Integration to Our Application
- Not in current scope. Could be a future "highlight region" feature where users draw rectangles around parts of the diagram they want to call attention to.

---

## 5. Caption Frame Marker

### User's Point of View
- A rectangle with a colored header bar containing editable text (seen as "Main board" in the demo).
- Drag to draw the rectangle. A text label appears at the top.
- Double-click the label to edit the text.
- The header bar color matches the stroke color.

### Developer's Point of View
- **Class**: `RectangularBoxMarkerBase → CaptionFrameMarker`
- **State**: `CaptionFrameMarkerState { left, top, width, height, text, color, fontFamily, fontSize, padding }`
- **Rendering**: SVG `<rect>` for the frame + a filled `<rect>` for the header bar + `<text>` for the caption
- **Text editing**: Uses `TextBlock` component with word wrapping and `requestAnimationFrame`-based positioning

### Integration to Our Application
- Could replace our simple "note" text annotation with a more structured callout. The header bar + rectangle pattern is a common annotation style in technical documentation.

---

## 6. Cover Marker (Filled Rectangle)

### User's Point of View
- A filled, opaque rectangle used to cover/redact parts of an image.
- Drag to draw. The rectangle is filled with a solid color (default: black).
- Useful for hiding sensitive information.

### Developer's Point of View
- **Class**: `RectangularBoxMarkerBase → ShapeMarkerBase → CoverMarker`
- **State**: `{ left, top, width, height, fillColor, opacity }`
- **Key detail**: `CoverMarker.applyDefaultFilter = false` — drop shadows are NOT applied to cover markers (they need clean edges for redaction)

### Integration to Our Application
- Useful as a "redact" tool for hiding sensitive parts of diagrams before sharing. Low priority but high-value for enterprise users who export diagrams with confidential data.

---

## 7. Highlight Marker

### User's Point of View
- A semi-transparent colored rectangle overlaid on the image.
- Similar to using a physical highlighter on a printout.
- Default: yellow at ~30% opacity.

### Developer's Point of View
- **Class**: `RectangularBoxMarkerBase → ShapeMarkerBase → HighlightMarker`
- **State**: `{ left, top, width, height, fillColor, opacity }`
- **Default opacity**: Lower than CoverMarker — designed to be see-through

### Integration to Our Application
- Could be an alternative to our watermark. A "highlight region" tool that draws attention to specific parts of the diagram with a transparent overlay.

---

## 8. Ellipse Markers (Frame + Filled)

### User's Point of View
- Draw ellipses/circles on the image. Available as outline-only (EllipseFrame) or filled (Ellipse).
- Drag to draw. Aspect ratio is free-form (hold Shift for perfect circle in some implementations).

### Developer's Point of View
- **Classes**: `EllipseFrameMarker` (outline), `EllipseMarker` (filled)
- **Rendering**: SVG `<ellipse>` element with `cx, cy, rx, ry`
- **Same grip system** as rectangles (8 grips + rotation)

### Integration to Our Application
- Circles are a natural annotation primitive for "circling" important parts. Could be a future addition alongside the arrow tool.

---

## 9. Text Marker

### User's Point of View
- Select the text tool (T icon). Click on the image to place a text box.
- An editable text area appears. Type your text.
- The text box has 8 resize grips and a rotation handle.
- Font size, color, font family are customizable.

### Developer's Point of View
- **Class**: `RectangularBoxMarkerBase → TextMarker`
- **State**: `TextMarkerState { left, top, width, height, text, color, fontFamily, fontSize: { value, units, step }, padding, rotationAngle }`
- **Text rendering**: Uses `TextBlock` component that splits text into lines, renders as SVG `<text>` with `<tspan>` elements.
- **Word wrapping**: Adjusts to the bounding box aspect ratio
- **Async rendering**: Uses `requestAnimationFrame` before measuring text dimensions (SVG text measurement requires DOM insertion)
- **FontSize is structured**: `{ value: 1, units: 'rem', step: 0.1 }` — not just a number. This enables relative sizing.

### Integration to Our Application
- Our current "note" is a simple text overlay with click-to-place. markerjs3's text marker adds:
  - **Editable in-place** (double-click to edit)
  - **Resizable bounding box** (text reflows)
  - **Rotation** support
  - **Font selection** (beyond just size/color)
- Recommended: Add in-place editing for notes (double-click the note overlay to edit text directly, instead of editing in the sidebar).

---

## 10. Callout Marker

### User's Point of View
- A text box with a speech-bubble pointer/tip that can point to a specific location on the image.
- Drag to draw the text box. A triangular pointer extends from the box.
- The pointer tip can be dragged independently to point at any location.
- Double-click to edit the text.

### Developer's Point of View
- **Class**: `TextMarker → CalloutMarker`
- **State**: `CalloutMarkerState { ...TextMarkerState, tipPosition: { x, y } }`
- **Rendering**: SVG `<path>` with rounded corners (radius 5) for the box + triangular pointer computed from `tipPosition` relative to the box
- **Tip base points**: Calculated so the pointer widens at the base where it meets the box edge

### Integration to Our Application
- High-value addition. Instead of our separate note + arrow, a callout combines both: text with a built-in pointer. This is the most natural annotation for "label this part of the diagram."
- Implementation: A `CalloutMarker` that renders as a rounded rectangle with text + a triangular pointer. The pointer tip position is stored as normalized coordinates (like our `notePoint`).

---

## 11. Freehand Marker

### User's Point of View
- Select the pen tool. Click and drag to draw freehand strokes on the image.
- Strokes follow the cursor path exactly.
- Color and stroke width are customizable.

### Developer's Point of View
- **Class**: `FreehandMarker`
- **State**: `FreehandMarkerState { drawingImgUrl }` — stores the drawing as a data URL image
- **Rendering**: Captures the drawing as a bitmap, not as vector paths (simpler but not scalable)
- **Why bitmap**: Freehand paths can have thousands of points. Storing as SVG paths would be expensive. A bitmap snapshot is more efficient.

### Integration to Our Application
- Not a priority for diagram export. Freehand drawing is more relevant for screenshot annotation than structured diagram export.

---

## 12. Highlighter Marker

### User's Point of View
- Like freehand but with a wider, semi-transparent stroke.
- Simulates a physical highlighter pen.
- Good for drawing attention to text or regions.

### Developer's Point of View
- **Class**: `HighlighterMarker` extends `FreehandMarker`
- **Rendering**: Same bitmap approach but with higher stroke width and lower opacity

### Integration to Our Application
- Low priority. Same as freehand — more relevant for screenshot annotation.

---

## 13. Stamp Markers (Emoji/Icons)

### User's Point of View
- Select the stamp tool (emoji icon). Choose from predefined stamps: checkmark (✓), X mark (✗), or custom images.
- Click on the image to place the stamp.
- Drag to reposition. Resize grips available.

### Developer's Point of View
- **Classes**: `CheckImageMarker`, `XImageMarker`, `CustomImageMarker` — all extend `ImageMarkerBase`
- **State**: `ImageMarkerBaseState { left, top, width, height, src }`
- **Rendering**: SVG `<image>` element with the stamp image
- **CustomImageMarker**: Accepts any image URL as the stamp source

### Integration to Our Application
- Could be useful for adding icons or badges to exported diagrams (e.g., "Draft", "Approved", status indicators). Lower priority than arrows and text.

---

## 14. Measurement Marker

### User's Point of View
- Draw a line between two points. The line displays the distance/measurement.
- Useful for annotating dimensions or distances.

### Developer's Point of View
- **Class**: `LinearMarkerBase → MeasurementMarker`
- **Rendering**: Line with small perpendicular tick marks at each end + text label showing the measured distance

### Integration to Our Application
- Not relevant for diagram export. More suited to technical drawing or design review tools.

---

## 15. Select Tool

### User's Point of View
- The pointer/cursor tool (top-left of toolbar).
- Click a marker to select it. Grips and properties appear.
- Click empty space to deselect all.
- Selected markers can be moved, resized, rotated, or deleted.

### Developer's Point of View
- **Not a marker type** — it's the default editor mode
- **Selection**: `MarkerArea` tracks `selectedMarker`. Click dispatches `ownsTarget(el)` on each marker to find which one was hit.
- **State machine per marker**: `select → move | resize | rotate | edit`
- **Multi-select**: Not supported in base implementation (single selection only)

### Integration to Our Application
- We need a selection model. Currently our note and arrow are independent overlays. If we add multiple annotations, we need select/deselect behavior. Could start simple: click an overlay to show its grips, click empty space to deselect.

---

## 16. Delete Tool

### User's Point of View
- Trash icon in the toolbar.
- Select a marker first, then click trash to delete it.
- Keyboard shortcut: Delete or Backspace when a marker is selected.

### Developer's Point of View
- Removes the selected marker from `MarkerArea.markers[]` and removes its SVG elements from the DOM
- No undo in base implementation (markerjs UI adds undo)

### Integration to Our Application
- Already partially implemented: our arrow has a "click to reset" gesture, and note has a "✕" clear button. Could be unified into a single selection + delete pattern.

---

## 17. Export / Renderer

### User's Point of View
- Click the download icon (↓) in the toolbar.
- The annotated image is downloaded as a PNG/JPEG with all annotations baked in.
- Annotations maintain their visual fidelity in the export.

### Developer's Point of View
- **Renderer class** operates in 6 steps:
  1. Create a hidden SVG canvas in the DOM (visibility: hidden)
  2. Restore all marker states (create markers, set coordinates, create visuals)
  3. Copy SVG innerHTML to a fresh SVG element
  4. Convert SVG to Blob → ObjectURL → Image
  5. Draw original image on Canvas, then draw SVG image on top
  6. Export via `canvas.toDataURL()`, clean up hidden DOM elements
- **Key insight**: All annotation rendering happens in SVG first (for preview), then the SVG is rasterized to Canvas only for export. This ensures preview and export look identical.
- **Scale support**: `naturalSize = true` exports at the image's native resolution (not viewport size)
- **Markers-only mode**: `markersOnly = true` exports just the annotation layer without the background image

### Integration to Our Application
- Our current approach: capture diagram via `html-to-image`, then draw overlays on Canvas with `ctx.fillText`/`ctx.strokeStyle`. This creates a preview-vs-export mismatch risk.
- **Recommended improvement**: Render all overlays (note, arrow, watermark) as SVG in the preview, then rasterize the SVG overlay layer for export. This guarantees visual fidelity between preview and exported PNG.
- **Specifically**: Instead of drawing text with `ctx.fillText` in the export engine (which doesn't support `text-shadow`, font loading, etc.), render the overlays as SVG, convert to Blob, draw on Canvas.

---

## 18. State Serialization

### User's Point of View
- Not directly visible. Enables save/restore of annotations.
- Users can close and reopen the annotation editor with all markers preserved.

### Developer's Point of View
- **Three-level hierarchy**:
  - `AnnotationState { version, width, height, markers[], defaultFilter }`
  - `MarkerBaseState { typeName, strokeColor, strokeWidth, opacity, notes }`
  - Specialized states extend base: `ArrowMarkerState`, `TextMarkerState`, etc.
- **Round-trip**: `marker.getState()` → JSON → `marker.restoreState(json)`
- **Version field**: Enables format migrations across library updates
- **typeName**: Runtime polymorphism — `"ArrowMarker"` maps to `ArrowMarker` class via registry

### Integration to Our Application
- Currently our export settings are ephemeral (lost when modal closes). Could serialize annotation state to allow:
  - Persisting user's preferred export settings
  - Saving/loading annotation presets ("my standard export style")
  - Undo/redo by snapshotting state

---

## Summary: Priority Integration Recommendations

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| **P0** | Drag-to-draw arrows (replace click-click) | Medium | High — fundamental UX improvement |
| **P0** | Endpoint grip handles for arrow repositioning | Medium | High — enables precise adjustment |
| **P1** | Callout marker (text + pointer combined) | High | High — most natural diagram annotation |
| **P1** | SVG-first rendering for preview-export fidelity | High | High — eliminates mismatch bugs |
| **P2** | In-place text editing (double-click note to edit) | Medium | Medium — reduces sidebar dependency |
| **P2** | Selection model (click to select, grips appear) | Medium | Medium — foundation for multi-annotation |
| **P3** | Rectangle/ellipse highlight overlays | Medium | Medium — useful for calling attention |
| **P3** | State serialization for annotation persistence | Low | Low — nice-to-have for preset saving |
| **P3** | Cover/redact marker | Low | Low — enterprise feature |
