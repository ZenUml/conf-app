# Export Modal — Testing Plan

## Test Strategy

Every test category below is mapped to a `test.describe` block in `export-modal.spec.ts`.
After any code fix, the validation loop **must** run:

```bash
npx playwright test --config tests/export-modal/playwright.config.ts
```

All 65+ tests must pass before the fix is considered done.

---

## 1. Modal Structure (8 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 1.1 | Opens with preview + sidebar + divider | `.export-preview-pane`, `.export-sidebar`, `.export-divider` visible |
| 1.2 | Toolbar has 4 tool buttons | `.annotation-toolbar .tool-btn` count = 4 |
| 1.3 | Sidebar shows Theme & Background sections | Section headings contain "theme" and "background" |
| 1.4 | Sidebar shows hint when no annotation selected | `.annotation-hint` visible, contains "Use the toolbar" |
| 1.5 | Preview shows captured diagram image | `.preview-real-diagram` visible, `src` contains `data:image/png` |
| 1.6 | Close button dismisses modal | `.sidebar-close` click → backdrop not visible |
| 1.7 | Backdrop click dismisses modal | Click position (5,5) on `.export-modal-backdrop` → backdrop not visible |
| 1.8 | Cancel button dismisses modal | `.btn-cancel` click → backdrop not visible |

## 2. Theme & Background (3 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 2.1 | Theme cards clickable + active state | 4 `.theme-card` elements, each gets `.active` class on click |
| 2.2 | Background swatches clickable + active state | ≥4 `.bg-swatch` elements, each gets `.active` class on click |
| 2.3 | Transparent background shows checkerboard | `.swatch-transparent` click → `.preview-canvas-wrap` has `linear-gradient` background |

## 3. Arrow Tool (11 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 3.1 | Click activates with highlight | `.tool-btn[title*="Arrow"]` gets `.active` class |
| 3.2 | Shows "Drag to draw arrow" hint | `.arrow-click-hint` text visible |
| 3.3 | Drag creates arrow with line + arrowhead | `.arrow-overlay line` and `.arrow-overlay path` visible after drag |
| 3.4 | Tool deactivates after drawing | Arrow button loses `.active` class |
| 3.5 | Shows "Release to finish" during drag | Hint text changes during `pointerdown → pointermove` |
| 3.6 | Very short drag does NOT create arrow | Distance < 0.01 normalized → no arrow line visible |
| 3.7 | Selection shows Arrow Properties | Sidebar has "Arrow Properties" with `.field-select`, `.field-color`, `.field-range` |
| 3.8 | Grip handles appear when selected | 2× `.grip-handle` circles visible |
| 3.9 | Color change in sidebar updates SVG | `.field-color` fill → `.arrow-line-body` stroke attribute changes |
| 3.10 | Grip drag repositions endpoint | Drag end grip → `x2` attribute of line changes |
| 3.11 | Arrow body drag moves entire arrow | Drag `.arrow-hit-area` → both `x1`,`y1` change |
| 3.12 | Label input shows text on arrow | Fill `.field-input[placeholder*="label"]` → `.arrow-overlay text` visible with content |

## 4. Note Tool (9 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 4.1 | Click activates with hint | `.tool-btn[title*="Note"]` gets `.active`, "Click to place note" hint |
| 4.2 | Click canvas places note | `.note-overlay text` visible with text "Note" |
| 4.3 | Tool deactivates after placing | Note button loses `.active` class |
| 4.4 | Has draggable-note class + grab cursor | `.draggable-note` class, `cursor: grab` computed style |
| 4.5 | Selection shows Note Properties | Sidebar: "Note Properties" with `.field-input`, `.field-range`, `.field-color` |
| 4.6 | Double-click opens edit input | `dispatchEvent('dblclick')` → `.note-edit-input` visible |
| 4.7 | Edit via in-place editor updates SVG | Fill + Enter in `.note-edit-input` → SVG text content changes |
| 4.8 | Edit via sidebar updates SVG | Fill sidebar `.field-input` → SVG text content changes |
| 4.9 | Drag moves to new position | `pointerdown → pointermove → pointerup` → `x`, `y` attributes change |

## 5. Callout Tool (9 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 5.1 | Click activates with hint | `.tool-btn[title*="Callout"]` gets `.active`, "Click to place callout" hint |
| 5.2 | Click canvas places callout + default text | `.callout-overlay path` visible, `d` contains "Q", text = "Callout" |
| 5.3 | Tool deactivates after placing | Callout button loses `.active` class |
| 5.4 | Selection shows Callout Properties | Sidebar: "Callout Properties" with `.field-input`, `.field-range` |
| 5.5 | Tip grip appears when selected | `.callout-overlay .grip-handle` visible |
| 5.6 | Body has move cursor | `.callout-overlay` style contains `cursor: move` |
| 5.7 | Body drag moves callout | Drag callout text → `x` attribute changes |
| 5.8 | Edit text in sidebar updates SVG | Fill sidebar input → `.callout-overlay text` changes |
| 5.9 | Tip grip drag repositions tip | Drag grip → `d` attribute of path changes |

## 6. Watermark Tool (6 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 6.1 | Click adds watermark immediately | `.watermark-overlay text` visible, text = "Confidential" |
| 6.2 | Auto-selected with properties visible | "Watermark Properties" section with `.field-input`, 2× `.field-range`, `.field-select` |
| 6.3 | Button toggles off | Second click → `.watermark-overlay text` not visible |
| 6.4 | Text change in sidebar updates SVG | Fill input with "DRAFT" → SVG text content = "DRAFT" |
| 6.5 | Diagonal mode has rotation transform | `transform` attribute contains `rotate(-45` |
| 6.6 | Re-enable after removal works | Off → On → watermark re-appears with text "Confidential" |

## 7. SVG Overlay Layer (3 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 7.1 | Proper viewBox | `viewBox` matches `0 0 \d+ \d+` |
| 7.2 | Note has drop shadow filter | `filter` attribute contains `drop-shadow` |
| 7.3 | Overlay becomes interactive when tool active | `style` contains `pointer-events: auto` and `cursor: crosshair` |

## 8. Selection & Delete (9 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 8.1 | Escape deactivates active tool | Arrow button loses `.active` after Escape |
| 8.2 | Escape deselects annotation | Note Properties section disappears after Escape |
| 8.3 | Delete removes selected arrow | Arrow line not visible after Delete key |
| 8.4 | Delete removes selected note | Note text not visible after Delete key |
| 8.5 | Delete removes selected callout | Callout path not visible after Delete key |
| 8.6 | Remove button deletes arrow | "Remove Arrow" click → arrow line not visible |
| 8.7 | Remove button deletes watermark | "Remove Watermark" click → watermark text not visible |
| 8.8 | Re-draw arrow after deletion | Delete + draw → new arrow line visible |
| 8.9 | Click empty space deselects | Click corner → properties section disappears |

## 9. Multi-Annotation Interactions (2 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 9.1 | All 4 annotation types coexist | Arrow line + note text + callout path + watermark text all visible |
| 9.2 | Selecting switches sidebar context | Click arrow → "Arrow Properties"; click note → "Note Properties" (arrow gone) |

## 10. Export Pipeline (4 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 10.1 | Download button present + enabled | `.btn-export` visible, text matches "Download PNG", enabled |
| 10.2 | Export triggers download | `download` event fires, filename = `zenuml-diagram-export.png` |
| 10.3 | Loading state during export | Button text changes to "Exporting…" |
| 10.4 | Export with all overlays → valid PNG | All 4 annotations placed → download fires, path truthy |

---

## Validation Loop

After every code change:

```bash
# Step 1: Run Playwright tests (must all pass)
npx playwright test --config tests/export-modal/playwright.config.ts

# Step 2: Run unit tests (must not regress)
pnpm test:unit

# Step 3: If either fails, fix and re-run. Do not stop until both pass.
```

**Total tests**: 75 Playwright E2E + 158 unit tests = 233 tests
**Expected runtime**: ~4 min (Playwright) + ~15s (unit) = ~4.5 min per validation loop

---

## 11. Sidebar Property Variants (10 tests)

| # | Test | Verified Behavior |
|---|------|-------------------|
| 11.1 | Watermark bottom-right position | `selectOption('bottom-right')` → no `transform`, `text-anchor` = "end" |
| 11.2 | Arrow type double shows 2 heads | `selectOption('←→')` → 2× `.arrow-overlay path` |
| 11.3 | Arrow type left reverses head | `selectOption('←')` → 1× `.arrow-overlay path` |
| 11.4 | Callout bgColor updates SVG fill | Fill 2nd `.field-color` with `#ff0000` → path `fill` = "#ff0000" |
| 11.5 | Note font-size slider updates SVG | Set range to 20 → `font-size` attribute = "20" |
| 11.6 | Watermark opacity slider updates SVG | Set range to 40 → `opacity` ≈ 0.4 |
| 11.7 | Note color change updates SVG fill | Fill `.field-color` → text `fill` attribute changes |
| 11.8 | Arrow thickness slider updates SVG | Set range to 5 → `stroke-width` = "5" |
| 11.9 | Remove note via sidebar button | "Remove Note" click → note text not visible |
| 11.10 | Remove callout via sidebar button | "Remove Callout" click → callout path not visible |

---

## Coverage Gaps (remaining)

| Gap | Risk | Notes |
|-----|------|-------|
| Export PNG pixel-level content | Medium | We verify download fires + filename, but not that the PNG actually contains overlays |
| Note preset positions (top-left, etc.) | Low | Only click-to-place tested; sidebar preset select not exercised |
| Theme change re-captures preview | Medium | Theme switch triggers `scheduleCapturePreview` but re-capture not verified |
| Modal keyboard accessibility | Low | Tab order, focus trapping not tested |
| Responsive layout | Low | Not tested at narrow viewports |
