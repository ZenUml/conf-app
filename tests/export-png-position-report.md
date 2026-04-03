# Export PNG — Relative Position Issues Report

**Date**: 2026-04-03
**File analyzed**: `~/Downloads/zenuml-diagram-export.png` (18 KB, downloaded today)
**Diagram content**: Simple A → B1 two-box flowchart with arrow annotation + callout annotation

---

## Image Overview

The exported PNG contains:
- **Diagram**: Two boxes "A" (top) and "B1" (bottom) connected by a vertical arrow, centered horizontally
- **Arrow annotation**: Red line with arrowhead, positioned in the upper-left quadrant
- **Callout annotation**: "Callout1111" speech bubble with tail, positioned in the left-center area

The image has a very wide aspect ratio (~4:1), with the diagram occupying roughly the center 30% of the horizontal space.

---

## Issues Found

### ISSUE 1 — Arrow Annotation Disconnected from Diagram Elements

| Property | Value |
|----------|-------|
| Severity | **High** |
| Affected | Red arrow overlay |

The red arrow starts at roughly (7%, 22%) of the image and ends at roughly (32%, 28%). The main diagram elements (A and B1 boxes) are centered at approximately x=50%. This means the arrow is positioned entirely in empty whitespace to the left of the diagram, visually disconnected from any diagram element.

**Root cause**: In the preview, the overlay SVG uses a fixed `viewBox="0 0 600 400"` with `preserveAspectRatio="xMidYMid meet"`. When the captured diagram image has a wide aspect ratio, the preview image is centered within the overlay's coordinate space, but the user draws the arrow relative to the overlay container — not relative to the diagram image. In the export, normalized coordinates (0-1) are mapped linearly to the full image width, causing a horizontal shift.

**Code reference**: `OverlayLayer.vue` line 5 vs `useExportEngine.ts` line 99:

```
// Preview: SVG viewBox is 600×400, overlaid on preview-canvas container
viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet"

// Export: coordinates mapped linearly to full image dimensions
const sx = pts.start.x * w;  // x * imageWidth
const sy = pts.start.y * h;  // y * imageHeight
```

---

### ISSUE 2 — Callout Position Shifted Away from Diagram

| Property | Value |
|----------|-------|
| Severity | **High** |
| Affected | Callout "Callout1111" |

The callout speech bubble is at approximately (25%, 48%) of the image, placing it in empty space to the left of the centered diagram. The callout tail points down-right toward roughly (33%, 68%), also in whitespace. Neither the bubble nor the tail overlaps any diagram element.

**Same root cause as Issue 1**: The preview-to-export coordinate mapping doesn't account for the aspect ratio difference between the preview overlay viewBox and the actual captured image.

---

### ISSUE 3 — Aspect Ratio Mismatch: Preview ViewBox vs Exported Image

| Property | Value |
|----------|-------|
| Severity | **Critical** (architectural) |
| Affected | All annotation types |

The preview overlay uses a hardcoded `600×400` viewBox (3:2 aspect ratio), but the captured diagram image can have **any** aspect ratio. For this particular diagram, the `.screen-capture-content` element produced a very wide image (~4:1 ratio).

The `preserveAspectRatio="xMidYMid meet"` on the preview SVG means:
- The SVG content is scaled uniformly to fit the shorter dimension
- Letterboxing occurs on the wider dimension
- The user sees the SVG centered, but their interactions map to the **viewBox** coordinate system, not the **image** coordinate system

In the export, coordinates are mapped linearly: `x * imageWidth`, `y * imageHeight`. This produces correct percentage positions **relative to the full image**, but these don't match what the user saw in the preview where the SVG content was letterboxed.

**Example**: If the user places a callout at the center of the preview diagram, the normalized coordinate might be (0.5, 0.5). This maps to the center of the export image — which is correct. But if the diagram only occupies the center 30% of the captured image width, the callout will appear centered in the image but offset from the diagram.

---

### ISSUE 4 — Annotation Elements Scaled Too Small for Wide Images

| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Affected | Callout bubble, arrowheads, text sizes |

The export engine computes a uniform scale factor:

```typescript
const scaleX = w / PREVIEW_VIEWBOX_W;  // e.g. 1024/600 = 1.71
const scaleY = h / PREVIEW_VIEWBOX_H;  // e.g. 263/400  = 0.66
const scale = Math.min(scaleX, scaleY); // = 0.66
```

For wide images where height is the limiting dimension, this scale factor is less than 1.0, causing:

| Element | Preview size | Export size | Ratio |
|---------|-------------|-------------|-------|
| Callout bubble width | 120 viewBox units (20% of 600) | 120 × 0.66 = 79px (7.7% of 1024) | 2.6× smaller |
| Callout bubble height | 40 viewBox units (10% of 400) | 40 × 0.66 = 26px (10% of 263) | Same |
| Arrowhead size | proportional to viewBox | scaled by 0.66 | Smaller |
| Text font size | 14 viewBox units | 14 × 0.66 = 9.2px | Smaller |

The callout bubble appears proportionally much narrower relative to the image width in the export than in the preview.

---

### ISSUE 5 — Callout Tail Connects to Empty Space

| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Affected | Callout tip/tail direction |

The callout's speech bubble tail points down-right into empty whitespace rather than toward a diagram element. The tail emanates from the bottom of the bubble and terminates at approximately (33%, 68%), which is in the left third of the image — far from the centered diagram content.

This is a consequence of Issue 2 (coordinate shift) combined with the fact that the tip position is also stored in normalized coordinates.

---

### ISSUE 6 — Large Empty Margins in Captured Image

| Property | Value |
|----------|-------|
| Severity | **Low** |
| Affected | Overall export quality |

The `.screen-capture-content` element produces an image significantly wider than the visible diagram content. The A→B1 diagram occupies roughly 20–30% of the total image width, with ~35% empty space on each side. This empty margin:
- Wastes image area
- Exacerbates annotation positioning issues (more empty space for coordinates to land in)
- Results in a visual "off-center" feel for annotations

---

## Summary Table

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | Arrow disconnected from diagram | High | Position |
| 2 | Callout shifted away from diagram | High | Position |
| 3 | Aspect ratio mismatch (preview vs export) | Critical | Architecture |
| 4 | Annotations scaled too small for wide images | Medium | Scaling |
| 5 | Callout tail points to empty space | Medium | Position |
| 6 | Large empty margins in captured image | Low | Layout |

---

## Recommended Fixes

### Fix for Issues 1, 2, 3, 5 — Align overlay coordinate system with diagram image

The overlay SVG viewBox should dynamically match the aspect ratio of the captured preview image, not use a hardcoded 600×400. When the preview image loads:

1. Read its natural width/height
2. Set the overlay `viewBox` to `0 0 <imgWidth> <imgHeight>` (or a proportional equivalent)
3. This ensures the overlay coordinate space maps 1:1 with the image content

Alternatively, the overlay could be constrained to cover **only** the `<img>` element (not the full `.preview-canvas` container).

### Fix for Issue 4 — Use independent X/Y scaling

Instead of `scale = Math.min(scaleX, scaleY)`, use separate X and Y scale factors for width-dependent vs height-dependent properties:
- Callout bubble width → scale by `scaleX`
- Callout bubble height → scale by `scaleY`
- Font sizes → scale by geometric mean `sqrt(scaleX * scaleY)` or use `scaleY` for readability

### Fix for Issue 6 — Crop or trim captured image

Either:
- Apply `html-to-image` with a crop/clip to the visible content bounds
- Or trim whitespace from the captured image before compositing overlays
