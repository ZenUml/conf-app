# svgkit: drawing primitives for model-authored generators

**Boundary: this is a drawing kit, not a layout engine.** You, the author of the generator, choose every
coordinate: node positions, container boxes, label and legend positions, and every point of every route.
The kit never picks a position, a port or anchor, a routing track, a layer or order, and it never searches
layouts. It turns decisions you already made into rule-conformant SVG and raises `ValueError` when your input
breaks a rule, instead of silently repairing it. Layout, ports and routes remain your job (Diagram Rules
"Route-aware node placement" still applies to you).

```python
import sys; sys.path.insert(0, "<kit directory>")
import svgkit as k
```

Stdlib only, Python 3. See `example.py` for a complete synthetic generator.

## What it does for you

| Need | API |
|---|---|
| Node shapes | `node(id, shape, x, y, label, fill=, stroke=, text_color=, ...)` with shape `rect` (r=4), `capsule`, `decision` (diamond for S tier, long-text hexagon with top/bottom points otherwise, 10-unit fillet), `store` (cylinder), `queue`. Returns a `Node` (`.svg`, `.x/.y/.w/.h`, `.label_box`, `.tier`, `.polygon`). Declares `data-node` and `data-label-box`; one `<text>` per line. |
| Label box tiers | `fit_label(text, font_size=18, min_tier=None)` picks the smallest of S 96x40, M 200x80, L 320x120, XL 480x160 (8-unit inset for rect/capsule). `node(..., tier=, min_tier=)` lets comparable nodes share a tier. `max_font(text, tier)` returns the largest whole font size (14-28) that fits a tier's label box, and `peer_font(texts, tier)` the smallest such maximum across comparable nodes (pass it as `font_size=`). Node label text carries `data-role="label"`, which the labelFontFit check reads. |
| Text | `measure_text`, `wrap_text`: deterministic per-glyph upper bound of Chromium glyph widths at font sizes 12-24 (may overstate by ~10%; pass explicit lines if that pushes a label up a tier). The auditor measures real glyphs. |
| Port arithmetic | `node.edge_point(face, t)`: converts YOUR face and fraction into a point, allowing for rounded corners and fillet-pulled tips. No default `t`; invalid spots raise. |
| Connectors | `connector(source, target, points, stroke=, dashed=False)` draws your orthogonal polyline with one uniform r=5 fillet per bend (a collinear continuation is the same leg; a reversal raises), `stroke-width="1"`, `data-source/data-target`, `marker-end` in the stroke colour. Any `check_route` problem raises. `check_route(points)` lists rule problems (orthogonality, reversal, room for fillets, rule 13 final leg >= trim + 10 + 8). `fillet_path(points)` returns bare path data. Colours are `#rgb`/`#rrggbb`. |
| Arrowhead | `marker_def(color)`: one fixed marker geometry (`userSpaceOnUse`, 10x10, `M0,0 L10,5 L0,10`, `refX=10`), id `arrow-<rrggbb>`, filled with that colour (`context-stroke` is not used: WebKit/Safari paints it black). `svg_document` emits one per connector colour found in your parts; emit them yourself only if you skip `svg_document`. |
| Edge labels | `edge_label(source, target, text, x, y, text_color=, canvas=)` pill (text/canvas contrast >= 4.5:1 or it raises) with canvas-coloured background and `data-edge-label-source/target`; returns `.svg` and `.box`. |
| Containers | `container(group_id, x, y, w, h, title, subtitle=None, ...)`: outline plus heading as direct children (`data-group`); top `HEADING_HEIGHT` units are the heading area. Draw before its nodes. |
| Legend | `legend_swatch(..., canvas=)`, `legend_line(..., canvas=)`; caption contrast is checked against `canvas`. |
| Palette | `palette_token(name, subtle_bg=, subtle_text=, border=, meaning=, bold_bg=, inverse_text=)` (meaning required) checks every pair at 4.5:1; `node`, `container`, `edge_label` and legends also raise on a text pair below 4.5:1; `contrast_ratio`, `check_contrast`, `palette_comment` |
| Document | `svg_document(width, height, parts, title=, desc=, canvas=, tokens=)`: title/desc, palette comment (required: `tokens=` or `comment=`, else it raises), one marker per connector colour, canvas, your parts. `esc` for XML escaping. |

## What it will not do

Choose where anything goes; pick faces or anchors; allocate tracks; avoid crossings; fold, rank or order
nodes; minimise bends; or check clearances between your routes. Render and inspect as usual, and call
`diagram_inspect`: the independent audit and your own eyes remain the check.

Tests: `python3 -m unittest discover -s kit -p 'test_*.py'` (also run by `npm test`).
