"""Synthetic usage example: every coordinate and route point below is chosen here, by the caller.
Run `python3 example.py > out.svg`. Source it draws:  A[Start] --> B{Ready};  B -- "Yes" --> C[(Store)];  B -.-> D(Skip)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svgkit as k  # noqa: E402

CANVAS = "#ffffff"
tok = k.palette_token("step", subtle_bg="#e8f1fb", subtle_text="#12355b", border="#2563a8", meaning="Process step")
style = dict(fill=tok["subtle_bg"], stroke=tok["border"], text_color=tok["subtle_text"])

a = k.node("A", "rect", 20, 128, "Start", **style)
b = k.node("B", "decision", 220, 108, "Ready", **style)
c = k.node("C", "store", 520, 116, "Store", **style)
d = k.node("D", "capsule", 520, 260, "Skip", **style)

# Route points are decided here, from each node's own edge_point(face, t).
ab = [a.edge_point("right", 0.5), b.edge_point("left", 0.5)]
bc = [b.edge_point("right", 0.5), c.edge_point("left", 0.5)]
b_bottom, d_left = b.edge_point("bottom", 0.5), d.edge_point("left", 0.5)
bd = [b_bottom, (b_bottom[0], d_left[1]), d_left]

parts = [
    k.connector("A", "B", ab, stroke=tok["border"]),
    k.connector("B", "C", bc, stroke=tok["border"]),
    k.connector("B", "D", bd, stroke=tok["border"], dashed=True),
    a.svg, b.svg, c.svg, d.svg,
    k.edge_label("B", "C", "Yes", 460, 128, text_color=tok["subtle_text"], canvas=CANVAS).svg,
    k.legend_swatch(20, 20, "Process step", **style, canvas=CANVAS),
    k.legend_line(240, 29, 48, "Dashed relation", stroke=tok["border"], text_color=tok["subtle_text"], canvas=CANVAS, dashed=True),
]
print(k.svg_document(700, 380, parts, title="Synthetic flow", desc="Three relationships between four synthetic nodes.",
                     canvas=CANVAS, tokens=[tok]))
