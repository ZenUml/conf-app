"""svgkit: optional SVG primitives for a model-authored diagram generator (stdlib only).

BOUNDARY. This is a drawing kit, not a layout engine. The CALLER owns every coordinate:
node positions, container boxes, label positions, legend positions, and every point of
every route. The kit never chooses a position, a port or anchor, a routing track, a layer
or an order, and it never searches over layouts. It turns decisions you already made into
rule-conformant SVG, and it refuses (ValueError) input that breaks a rule, rather than
repairing it. Typical use:

    import sys; sys.path.insert(0, "<kit directory>")
    import svgkit as k

`measure_text` is a deterministic, conservative estimate (no font files, no browser). The
independent auditor measures real glyph boxes, so leave headroom if a label is close.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Sequence

# Rule constants (Diagram Rules): node r=4, connector fillet r=5, decision fillet 10,
# label box inset 12, four fixed label-box tiers, one marker geometry (one copy per colour), stroke-width 1 connectors.
TIERS = ((96, 40), (200, 80), (320, 120), (480, 160))
NODE_RADIUS = 4
CONNECTOR_RADIUS = 5
DECISION_FILLET = 10
LABEL_INSET = 12
MARKER_ID = "arrow"
MARKER_LENGTH = 10  # axial length of the marker triangle (refX=10)
SHAFT_MIN = 8  # rule 13: visible straight shaft before the arrowhead base
DASH = "6 4"
HEADING_HEIGHT = 64  # space reserved at the top of a container() for heading + subtitle
DEFAULT_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'


def _n(v: float) -> str:
    return f"{round(v, 3):g}"


# ---------------------------------------------------------------- escaping

def esc(text) -> str:
    """Escape text or an attribute value for XML."""
    return (str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def _comment(text: str) -> str:
    text = str(text)
    while "--" in text:
        text = text.replace("--", "-")
    return text.rstrip("-")


# ---------------------------------------------------------------- text measure and tiers

# Per-glyph widths in em: the largest Chromium getBBox width per glyph over font sizes 12-24 (runs of
# 1, 2 and 6, kit font stack, 2026-10-02), rounded up, so at those sizes the sum is an upper bound of
# the rendered width the auditor measures. It can overstate by ~10%; prefer explicit lines if a label
# lands one tier up only because of that margin.
_EM = {
    ' ': 0.29, '!': 0.32, '"': 0.48, '#': 0.64, '$': 0.64, '%': 0.93, '&': 0.72, "'": 0.3, '(': 0.39, ')': 0.39,
    '*': 0.48, '+': 0.64, ',': 0.3, '-': 0.48, '.': 0.3, '/': 0.31, '0': 0.64, '1': 0.47, '2': 0.61, '3': 0.63,
    '4': 0.65, '5': 0.62, '6': 0.64, '7': 0.59, '8': 0.64, '9': 0.64, ':': 0.3, ';': 0.3, '<': 0.64, '=': 0.64,
    '>': 0.64, '?': 0.52, '@': 0.92, 'A': 0.68, 'B': 0.66, 'C': 0.72, 'D': 0.73, 'E': 0.6, 'F': 0.58, 'G': 0.75,
    'H': 0.75, 'I': 0.27, 'J': 0.54, 'K': 0.66, 'L': 0.57, 'M': 0.88, 'N': 0.75, 'O': 0.78, 'P': 0.64, 'Q': 0.78,
    'R': 0.66, 'S': 0.64, 'T': 0.64, 'U': 0.74, 'V': 0.68, 'W': 0.97, 'X': 0.68, 'Y': 0.66, 'Z': 0.67, '[': 0.39,
    '\\': 0.31, ']': 0.39, '^': 0.64, '_': 0.59, '`': 0.51, 'a': 0.56, 'b': 0.62, 'c': 0.56, 'd': 0.62, 'e': 0.58,
    'f': 0.37, 'g': 0.61, 'h': 0.59, 'i': 0.25, 'j': 0.26, 'k': 0.55, 'l': 0.26, 'm': 0.88, 'n': 0.59, 'o': 0.6,
    'p': 0.62, 'q': 0.61, 'r': 0.39, 's': 0.53, 't': 0.37, 'u': 0.59, 'v': 0.55, 'w': 0.78, 'x': 0.53, 'y': 0.55,
    'z': 0.54, '{': 0.39, '|': 0.26, '}': 0.39, '~': 0.64,
}
_EM_OTHER = 0.95  # unmeasured Latin/symbol glyphs: as wide as the widest measured glyph
_EM_CJK = 1.0


def measure_text(text: str, font_size: float = 18) -> float:
    """Deterministic width estimate in SVG units: an upper bound of the measured browser glyph
    widths for printable ASCII (per-glyph table), wide fallbacks for anything else."""
    total = 0.0
    for ch in str(text):
        total += _EM.get(ch, _EM_CJK if ord(ch) > 0x2E80 else _EM_OTHER)
    return total * font_size


def wrap_text(text: str, max_width: float, font_size: float = 18) -> list[str]:
    """Greedy word wrap; explicit newlines are kept. A word wider than max_width stays whole
    (the caller then needs a larger tier) rather than being split mid-word."""
    lines: list[str] = []
    for para in str(text).split("\n"):
        line = ""
        for word in para.split():
            trial = f"{line} {word}" if line else word
            if line and measure_text(trial, font_size) > max_width:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
    return lines


@dataclass(frozen=True)
class Fit:
    tier: tuple
    lines: list
    font_size: float
    line_height: float


def _fits(lines, tier, font_size, line_height) -> bool:
    height = (len(lines) - 1) * line_height + 1.2 * font_size
    return height <= tier[1] and all(measure_text(l, font_size) <= tier[0] for l in lines)


def fit_label(text, font_size: float = 18, line_height: float | None = None, min_tier=None) -> Fit:
    """Smallest of the four tiers that holds the label. `text` is a string (wrapped here) or a
    list of lines you chose (kept). min_tier lets comparable nodes share one tier."""
    lh = line_height or round(font_size * 1.1)
    start = TIERS.index(tuple(min_tier)) if min_tier else 0
    for tier in TIERS[start:]:
        lines = list(text) if isinstance(text, (list, tuple)) else wrap_text(text, tier[0], font_size)
        if _fits(lines, tier, font_size, lh):
            return Fit(tier, lines, font_size, lh)
    raise ValueError("label does not fit the XL tier (480x160); shorten the text or split the node")


# ---------------------------------------------------------------- colour

def _rgb(color: str):
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", c):
        raise ValueError(f"unsupported colour {color!r}; use #rgb or #rrggbb")
    return tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex(color: str) -> str:
    """Canonical lowercase 6-digit hex (no #) of a #rgb/#rrggbb colour; anything else raises."""
    return "".join(f"{round(v * 255):02x}" for v in _rgb(color))


def _luminance(color: str) -> float:
    r, g, b = (v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in _rgb(color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg: str, bg: str) -> float:
    a, b = _luminance(fg), _luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def check_contrast(fg: str, bg: str, minimum: float = 4.5) -> float:
    ratio = contrast_ratio(fg, bg)
    if ratio < minimum:
        raise ValueError(f"contrast {ratio:.2f}:1 for {fg} on {bg} is below {minimum}:1")
    return ratio


def palette_token(name: str, *, subtle_bg: str, subtle_text: str, border: str, meaning: str,
                  bold_bg: str | None = None, inverse_text: str | None = None) -> dict:
    """One semantic role: subtle background + dark text, optional bold background + inverse text.
    Every pair is checked at 4.5:1; a failing pair raises. `meaning` is required (C1)."""
    if not str(meaning).strip():
        raise ValueError(f"palette role {name!r} needs a meaning (C1)")
    check_contrast(subtle_text, subtle_bg)
    if (bold_bg is None) != (inverse_text is None):
        raise ValueError("bold_bg and inverse_text come as a pair")
    if bold_bg:
        check_contrast(inverse_text, bold_bg)
    return dict(name=name, subtle_bg=subtle_bg, subtle_text=subtle_text, border=border, meaning=meaning,
                bold_bg=bold_bg, inverse_text=inverse_text)


def palette_comment(tokens: Sequence[dict]) -> str:
    """Text for the C1 source comment declaring each role; embed via svg_document(tokens=...)."""
    parts = []
    for t in tokens:
        s = f"{t['name']}: background.subtle {t['subtle_bg']} + text {t['subtle_text']}"
        if t.get("bold_bg"):
            s += f", background.bold {t['bold_bg']} + inverse {t['inverse_text']}"
        s += f", border {t['border']}"
        if t.get("meaning"):
            s += f" = {t['meaning']}"
        parts.append(s)
    return _comment("semantic-palette | " + " | ".join(parts))


# ---------------------------------------------------------------- connectors

def _legs(points):
    pts = [tuple(p) for p in points]
    if len(pts) < 2:
        raise ValueError("a route needs at least two points")
    out = [pts[0]]
    for p in pts[1:]:
        if p == out[-1]:
            raise ValueError(f"zero-length leg at {p}")
        a, b = out[-1], p
        if a[0] != b[0] and a[1] != b[1]:
            raise ValueError(f"leg {a}->{b} is not orthogonal")
        # A collinear same-direction continuation is the same leg (a split corner stays one bend);
        # a collinear reversal doubles back over itself and is refused, never drawn as a bend.
        if len(out) >= 2:
            o = out[-2]
            if o[0] == a[0] == b[0] or o[1] == a[1] == b[1]:
                if (a[0] - o[0]) * (b[0] - a[0]) + (a[1] - o[1]) * (b[1] - a[1]) < 0:
                    raise ValueError(f"route reverses on itself at {a}")
                out[-1] = b
                continue
        out.append(b)
    return out


def _len(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def check_route(points, r: float = CONNECTOR_RADIUS) -> list[str]:
    """Rule problems in a route you chose (never changes it): orthogonality, room for each r fillet,
    and rule 13 (final leg >= fillet trim + marker length + 8)."""
    try:
        pts = _legs(points)
    except ValueError as exc:
        return [str(exc)]
    problems = []
    n_legs = len(pts) - 1
    for i in range(n_legs):
        length = _len(pts[i], pts[i + 1])
        need = (r if i > 0 else 0) + (r if i < n_legs - 1 else 0)
        if length < need:
            problems.append(f"leg {pts[i]}->{pts[i + 1]} is {length:g} long; needs {need:g} for r={r:g} fillets")
    final = _len(pts[-2], pts[-1])
    required = (r if n_legs > 1 else 0) + MARKER_LENGTH + SHAFT_MIN
    if final < required:
        problems.append(f"final leg is {final:g}; needs >= {required:g} (fillet + arrowhead {MARKER_LENGTH} + shaft {SHAFT_MIN})")
    return problems


def fillet_path(points, r: float = CONNECTOR_RADIUS) -> str:
    """Path data for the caller's polyline: straight L legs, one uniform r quadratic fillet per bend."""
    pts = _legs(points)
    d = f"M {_n(pts[0][0])},{_n(pts[0][1])}"
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        la, lc = _len(a, b), _len(b, c)
        if la < r or lc < r:
            raise ValueError(f"cannot fit an r={r:g} fillet at {b}")
        p = (b[0] + (a[0] - b[0]) * r / la, b[1] + (a[1] - b[1]) * r / la)
        q = (b[0] + (c[0] - b[0]) * r / lc, b[1] + (c[1] - b[1]) * r / lc)
        d += f" L {_n(p[0])},{_n(p[1])} Q {_n(b[0])},{_n(b[1])} {_n(q[0])},{_n(q[1])}"
    return d + f" L {_n(pts[-1][0])},{_n(pts[-1][1])}"


def marker_id(color: str) -> str:
    """id of the arrowhead marker for one connector colour: arrow-<rrggbb>."""
    return f"{MARKER_ID}-{_hex(color)}"


def marker_def(color: str) -> str:
    """The arrowhead for one connector colour: userSpaceOnUse, one fixed size, tip at refX=10.
    Every colour gets an identical marker except its fill; `context-stroke` is not used because
    WebKit/Safari paints it black. svg_document emits one per colour your connectors use."""
    return (f'<marker id="{marker_id(color)}" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" '
            f'refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#{_hex(color)}"/></marker>')


def connector(source: str, target: str, points, *, stroke: str, dashed: bool = False,
              edge_id: str | None = None, r: float = CONNECTOR_RADIUS) -> str:
    """One logical relationship as one complete path along the points YOU give (source boundary
    to target boundary). Binds data-source/data-target; stroke-width 1; marker-end in the stroke
    colour. A route that breaks a rule raises; it is never repaired."""
    problems = check_route(points, r)
    if problems:
        raise ValueError(f"route {source}->{target}: " + "; ".join(problems))
    ident = f' id="{esc(edge_id)}"' if edge_id else ""
    dash = f' stroke-dasharray="{DASH}"' if dashed else ""
    return (f'<path{ident} data-source="{esc(source)}" data-target="{esc(target)}" d="{fillet_path(points, r)}" '
            f'fill="none" stroke="#{_hex(stroke)}" stroke-width="1"{dash} marker-end="url(#{marker_id(stroke)})"/>')


# ---------------------------------------------------------------- shapes

def _toward(v, other, radius):
    length = math.hypot(other[0] - v[0], other[1] - v[1])
    t = min(radius, length / 3) / length
    return (v[0] + (other[0] - v[0]) * t, v[1] + (other[1] - v[1]) * t)


def _rounded_polygon(points, radius: float = DECISION_FILLET) -> str:
    n = len(points)
    before = [_toward(p, points[i - 1], radius) for i, p in enumerate(points)]
    after = [_toward(p, points[(i + 1) % n], radius) for i, p in enumerate(points)]
    d = f"M {_n(after[0][0])},{_n(after[0][1])}"
    for i in range(1, n + 1):
        j = i % n
        d += f" L {_n(before[j][0])},{_n(before[j][1])} Q {_n(points[j][0])},{_n(points[j][1])} {_n(after[j][0])},{_n(after[j][1])}"
    return d + " Z"


def _vertex_outline_point(poly, i, radius=DECISION_FILLET):
    """Midpoint of the fillet curve at vertex i: where the visible outline actually is at a tip."""
    v = poly[i]
    p0, p2 = _toward(v, poly[i - 1], radius), _toward(v, poly[(i + 1) % len(poly)], radius)
    return (0.25 * p0[0] + 0.5 * v[0] + 0.25 * p2[0], 0.25 * p0[1] + 0.5 * v[1] + 0.25 * p2[1])


def _in_polygon(px, py, poly) -> bool:
    inside = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


@dataclass
class Node:
    id: str
    shape: str
    variant: str
    x: float
    y: float
    w: float
    h: float
    label_box: tuple
    tier: tuple
    lines: list
    svg: str
    polygon: list = field(default_factory=list)

    @property
    def bbox(self):
        return (self.x, self.y, self.w, self.h)

    def edge_point(self, face: str, t: float):
        """Point on `face` at fraction t along it. Pure arithmetic: YOU choose face and t (there is no
        default). Raises ValueError where that point is not on a straight, flat part of the outline
        (rounded corner, cap, or a tip that only exists at t=0.5)."""
        x, y, w, h = self.x, self.y, self.w, self.h
        if face not in ("top", "bottom", "left", "right"):
            raise ValueError("face must be top, bottom, left or right")
        horiz = face in ("top", "bottom")  # the face runs along x
        span = w if horiz else h
        along = span * t

        def flat(margin, why):
            if not margin - 1e-9 <= along <= span - margin + 1e-9:
                raise ValueError(f"{self.id}: {face} t={t} is on {why}; pick a point on the flat part")

        def tip():
            if abs(t - 0.5) > 1e-9:
                raise ValueError(f"{self.id}: {face} of a {self.variant} only has a tip at t=0.5")

        if self.variant in ("diamond", "hexagon"):
            if face in ("top", "bottom") or self.variant == "diamond":
                tip()
                index = {"top": 0, "right": 1, "bottom": 2, "left": 3}[face] if self.variant == "diamond" else (0 if face == "top" else 3)
                return _vertex_outline_point(self.polygon, index)
            flat(20 + DECISION_FILLET, "a shoulder or fillet")
            return (x if face == "left" else x + w, y + along)
        if self.variant == "capsule":
            flat(h / 2, "a rounded end") if horiz else tip()
        elif self.variant == "store":
            tip() if horiz else flat(12, "a cap")
        elif self.variant == "queue":
            flat(12, "a cap") if horiz else tip()
        else:
            flat(NODE_RADIUS, "a rounded corner")
        if face == "top":
            return (x + along, y)
        if face == "bottom":
            return (x + along, y + h)
        return (x if face == "left" else x + w, y + along)


def _text_lines(lines, x, cy, anchor, fill, font_size, line_height) -> str:
    first = cy - (len(lines) - 1) * line_height / 2
    return "".join(
        f'<text x="{_n(x)}" y="{_n(first + i * line_height)}" text-anchor="{anchor}" dominant-baseline="central" '
        f'font-size="{_n(font_size)}" font-weight="400" fill="{esc(fill)}">{esc(line)}</text>'
        for i, line in enumerate(lines))


def node(id: str, shape: str, x: float, y: float, label, *, fill: str, stroke: str, text_color: str,
         tier=None, min_tier=None, font_size: float = 18, group: str | None = None,
         align: str = "center", stroke_width: float = 2, variant: str | None = None) -> Node:
    """One node drawn with its top-left at the (x, y) you give.

    shape: rect | capsule | decision | store | queue. A decision is a diamond for the S tier and the
    long-text hexagon (points top/bottom) otherwise; pass variant="diamond"|"hexagon" to override.
    The smallest label tier that fits is used unless `tier`/`min_tier` say otherwise. The label box,
    declared in data-label-box, is the tier rectangle (12-unit inset for rect/capsule)."""
    check_contrast(text_color, fill)
    fit = fit_label(label, font_size, min_tier=min_tier or tier)
    if tier and tuple(tier) != fit.tier:
        raise ValueError(f"{id}: label needs tier {fit.tier}, not {tuple(tier)}")
    lw, lh = fit.tier
    polygon: list = []
    paint = f'fill="{esc(fill)}" stroke="{esc(stroke)}" stroke-width="{_n(stroke_width)}"'
    if shape in ("rect", "capsule"):
        w, h, lb = lw + 2 * LABEL_INSET, lh + 2 * LABEL_INSET, (x + LABEL_INSET, y + LABEL_INSET, lw, lh)
        rx = NODE_RADIUS if shape == "rect" else h / 2
        outline = f'<rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" rx="{_n(rx)}" {paint}/>'
        var = shape
    elif shape == "decision":
        var = variant or ("diamond" if fit.tier == TIERS[0] else "hexagon")
        if var == "diamond":
            w, h = 2 * lw + 24, 2 * lh + 24
            polygon = [(x + w / 2, y), (x + w, y + h / 2), (x + w / 2, y + h), (x, y + h / 2)]
            lb = (x + (w - lw) / 2, y + (h - lh) / 2, lw, lh)
        elif var == "hexagon":
            w, h = lw + 80, lh + 60
            polygon = [(x + w / 2, y), (x + w, y + 20), (x + w, y + h - 20), (x + w / 2, y + h), (x, y + h - 20), (x, y + 20)]
            lb = (x + 40, y + 30, lw, lh)
        else:
            raise ValueError("variant must be diamond or hexagon")
        corners = [(lb[0], lb[1]), (lb[0] + lw, lb[1]), (lb[0], lb[1] + lh), (lb[0] + lw, lb[1] + lh)]
        if not all(_in_polygon(px, py, polygon) for px, py in corners):
            raise ValueError(f"{id}: label box does not fit inside a {var} at tier {fit.tier}; use a hexagon or larger tier")
        outline = f'<path d="{_rounded_polygon(polygon)}" {paint} stroke-linejoin="round"/>'
    elif shape == "store":
        w, h, lb, var = lw + 24, lh + 48, (x + 12, y + 24, lw, lh), "store"
        d = (f"M {_n(x)} {_n(y + 12)} C {_n(x)} {_n(y - 4)} {_n(x + w)} {_n(y - 4)} {_n(x + w)} {_n(y + 12)} "
             f"L {_n(x + w)} {_n(y + h - 12)} C {_n(x + w)} {_n(y + h + 4)} {_n(x)} {_n(y + h + 4)} {_n(x)} {_n(y + h - 12)} Z")
        cap = f"M {_n(x)} {_n(y + 12)} C {_n(x)} {_n(y + 28)} {_n(x + w)} {_n(y + 28)} {_n(x + w)} {_n(y + 12)}"
        outline = f'<path d="{d}" {paint}/><path d="{cap}" fill="none" stroke="{esc(stroke)}" stroke-width="{_n(stroke_width)}"/>'
    elif shape == "queue":
        w, h, lb, var = lw + 48, lh + 24, (x + 24, y + 12, lw, lh), "queue"
        d = (f"M {_n(x + 12)} {_n(y)} C {_n(x - 4)} {_n(y)} {_n(x - 4)} {_n(y + h)} {_n(x + 12)} {_n(y + h)} "
             f"L {_n(x + w - 12)} {_n(y + h)} C {_n(x + w + 4)} {_n(y + h)} {_n(x + w + 4)} {_n(y)} {_n(x + w - 12)} {_n(y)} Z")
        cap = f"M {_n(x + w - 12)} {_n(y)} C {_n(x + w - 28)} {_n(y)} {_n(x + w - 28)} {_n(y + h)} {_n(x + w - 12)} {_n(y + h)}"
        outline = f'<path d="{d}" {paint}/><path d="{cap}" fill="none" stroke="{esc(stroke)}" stroke-width="{_n(stroke_width)}"/>'
    else:
        raise ValueError("shape must be rect, capsule, decision, store or queue")
    cy = lb[1] + lb[3] / 2
    if align == "left":
        text = _text_lines(fit.lines, lb[0], cy, "start", text_color, fit.font_size, fit.line_height)
    else:
        text = _text_lines(fit.lines, lb[0] + lb[2] / 2, cy, "middle", text_color, fit.font_size, fit.line_height)
    parent = f' data-parent-group="{esc(group)}"' if group else ""
    svg = (f'<g data-node="{esc(id)}"{parent} data-shape="{var}" data-label-box="{_n(lb[0])} {_n(lb[1])} {_n(lb[2])} {_n(lb[3])}">'
           f'{outline}{text}</g>')
    return Node(id, shape, var, x, y, w, h, tuple(lb), fit.tier, fit.lines, svg, polygon)


# ---------------------------------------------------------------- labels, containers, legend

@dataclass
class Label:
    svg: str
    box: tuple  # x, y, w, h


def edge_label(source: str, target: str, text: str, x: float, y: float, *, text_color: str, canvas: str,
               font_size: float = 15) -> Label:
    """Pill with the canvas colour behind the text, top-left at the (x, y) you give. Bound to the
    relationship with data-edge-label-source/target."""
    check_contrast(text_color, canvas)
    w = 2 * math.ceil((measure_text(text, font_size) + 16) / 2)
    h = 24
    svg = (f'<g data-edge-label-source="{esc(source)}" data-edge-label-target="{esc(target)}">'
           f'<rect x="{_n(x)}" y="{_n(y)}" width="{w}" height="{h}" rx="{h // 2}" fill="{esc(canvas)}"/>'
           f'<text x="{_n(x + w / 2)}" y="{_n(y + h / 2)}" text-anchor="middle" dominant-baseline="central" '
           f'font-size="{_n(font_size)}" font-weight="400" fill="{esc(text_color)}">{esc(text)}</text></g>')
    return Label(svg, (x, y, w, h))


def container(group_id: str, x: float, y: float, w: float, h: float, title: str, *, fill: str, stroke: str,
              text_color: str, subtitle: str | None = None, title_size: float = 18, subtitle_size: float = 15) -> str:
    """Container outline with heading (and optional subtitle) as direct children, in the top
    HEADING_HEIGHT units of the box you give. Draw it before its nodes."""
    check_contrast(text_color, fill)
    sub = (f'<text x="{_n(x + 16)}" y="{_n(y + 46)}" font-size="{_n(subtitle_size)}" font-weight="400" '
           f'dominant-baseline="central" fill="{esc(text_color)}">{esc(subtitle)}</text>') if subtitle else ""
    return (f'<g data-group="{esc(group_id)}" data-container-id="{esc(group_id)}">'
            f'<rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" rx="{NODE_RADIUS}" fill="{esc(fill)}" '
            f'stroke="{esc(stroke)}" stroke-width="1"/>'
            f'<text x="{_n(x + 16)}" y="{_n(y + 24)}" font-size="{_n(title_size)}" font-weight="600" '
            f'dominant-baseline="central" fill="{esc(text_color)}">{esc(title)}</text>{sub}</g>')


def legend_swatch(x: float, y: float, label: str, *, fill: str, stroke: str, text_color: str, canvas: str,
                  shape: str = "rect", font_size: float = 16) -> str:
    """Legend key for a node colour/shape at the (x, y) you give (24x18 swatch, caption to its right
    on `canvas`)."""
    check_contrast(text_color, canvas)
    if shape == "decision":
        pts = [(x + 12, y), (x + 24, y + 9), (x + 12, y + 18), (x, y + 9)]
        mark = f'<path d="{_rounded_polygon(pts, 4)}" fill="{esc(fill)}" stroke="{esc(stroke)}" stroke-width="2"/>'
    else:
        rx = 9 if shape == "capsule" else NODE_RADIUS
        mark = (f'<rect x="{_n(x)}" y="{_n(y)}" width="24" height="18" rx="{rx}" fill="{esc(fill)}" '
                f'stroke="{esc(stroke)}" stroke-width="2"/>')
    return (f'<g data-legend="{esc(label)}">{mark}<text x="{_n(x + 34)}" y="{_n(y + 9)}" font-size="{_n(font_size)}" '
            f'font-weight="400" dominant-baseline="central" fill="{esc(text_color)}">{esc(label)}</text></g>')


def legend_line(x: float, y: float, length: float, label: str, *, stroke: str, text_color: str, canvas: str,
                dashed: bool = False, font_size: float = 16) -> str:
    """Legend key for a connector style: horizontal sample at (x, y), caption to its right on `canvas`."""
    check_contrast(text_color, canvas)
    dash = f' stroke-dasharray="{DASH}"' if dashed else ""
    return (f'<g data-legend="{esc(label)}"><path d="M {_n(x)},{_n(y)} L {_n(x + length)},{_n(y)}" fill="none" '
            f'stroke="#{_hex(stroke)}" stroke-width="1"{dash} marker-end="url(#{marker_id(stroke)})"/>'
            f'<text x="{_n(x + length + 12)}" y="{_n(y)}" font-size="{_n(font_size)}" font-weight="400" '
            f'dominant-baseline="central" fill="{esc(text_color)}">{esc(label)}</text></g>')


# ---------------------------------------------------------------- document

def svg_document(width: float, height: float, parts: Sequence[str], *, title: str, desc: str,
                 canvas: str = "#ffffff", comment: str | None = None, tokens: Sequence[dict] | None = None,
                 font_family: str = DEFAULT_FONT) -> str:
    """Assemble the standalone SVG: title/desc, palette comment (C1, required: pass tokens or
    comment), one identical marker per connector colour used in parts, canvas, then your parts in
    the order you give them (containers, connectors, nodes, labels, legend)."""
    note = comment if comment is not None else (palette_comment(tokens) if tokens else None)
    if not note or not str(note).strip():
        raise ValueError("declare the semantic palette (C1): pass tokens=[palette_token(...)] or comment=")
    head = f"<!-- {_comment(note)} -->"
    colours = sorted(set(re.findall(rf"url\(#{MARKER_ID}-([0-9a-f]{{6}})\)", "".join(parts))))
    markers = "".join(marker_def("#" + c) for c in colours)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{_n(width)}" height="{_n(height)}" '
            f'viewBox="0 0 {_n(width)} {_n(height)}" role="img">'
            f'<title>{esc(title)}</title><desc>{esc(desc)}</desc>{head}'
            f'<defs><style>text{{font-family:{font_family.replace("<", "").replace("&", "")}}}</style>{markers}</defs>'
            f'<rect width="{_n(width)}" height="{_n(height)}" fill="{esc(canvas)}"/>'
            + "\n".join(parts) + "</svg>\n")
