"""Render the quota frame and Google Cloud figures as a 600x800 grayscale PNG for a Kindle 4 (eips -g).

Q5 frame (same bytes the ESP32 receives): header lines Q5, sleep, nonce; 16 text lines, four per cell
(percent, countdown, reset clock, updated stamp); four 48-point charts; END. Cell order is
Claude 5 hours, Claude week, Codex week, Cursor week. The Kindle leaves out Claude 5 hours, because
Claude removed that limit.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 600, 800
CELL_HEIGHT = HEIGHT // 4
CHART_POINTS = 48
CHART_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno"
MAX_LEVEL = len(CHART_ALPHABET) - 1

CELLS = (("CLAUDE", "5 HOURS"), ("CLAUDE", "WEEK"), ("CODEX", "WEEK"), ("CURSOR", "WEEK"))
# Top to bottom: the weekly allowances Claude and Codex first, so they compare directly.
ROW_ORDER = (1, 2, 3)
GCP_TOP = len(ROW_ORDER) * CELL_HEIGHT

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"

MARGIN = 16
CHART_X0, CHART_X1 = 300, 584
CHART_TOP, CHART_BOTTOM = 56, 150


@dataclass
class Cell:
    provider: str
    window: str
    percent: str
    countdown: str
    reset: str
    updated: str
    chart: list


def parse_frame(text: str) -> list[Cell]:
    lines = text.splitlines()
    if len(lines) != 24 or lines[0] != "Q5" or lines[-1] != "END":
        raise ValueError("Expected a Q5 frame of 24 lines")
    fields, charts = lines[3:19], lines[19:23]
    cells = []
    for i, (provider, window) in enumerate(CELLS):
        chart = charts[i]
        if len(chart) != CHART_POINTS or any(c != "." and c not in CHART_ALPHABET for c in chart):
            raise ValueError("Chart line is invalid")
        levels = [None if c == "." else CHART_ALPHABET.index(c) for c in chart]
        cells.append(Cell(provider, window, *fields[i * 4:i * 4 + 4], levels))
    return cells


def _icon_reset(draw, x, y, size=20):
    draw.arc((x + 2, y + 4, x + 17, y + 19), start=20, end=290, fill=0, width=3)
    draw.polygon([(x + 13, y), (x + 19, y + 6), (x + 10, y + 9)], fill=0)


def _icon_updated(draw, x, y, size=20):
    cx = x + size // 2
    draw.line((cx, y + 1, cx, y + size - 8), fill=0, width=3)
    draw.polygon([(cx - 6, y + size - 11), (cx + 6, y + size - 11), (cx, y + size - 4)], fill=0)
    draw.line((x + 2, y + size - 1, x + size - 2, y + size - 1), fill=0, width=3)


def _draw_pace_line(draw, x0, x1, top, bottom):
    """Dashed diagonal: even use over the week. A curve below it is burning too fast."""
    for x in range(x0, x1, 12):
        end = min(x + 6, x1)
        y_at = lambda at: top + (at - x0) * (bottom - top) // (x1 - x0)
        draw.line((x, y_at(x), end, y_at(end)), fill=85, width=1)


def _draw_chart(draw, levels, x0, x1, top, bottom):
    points = []
    for i, level in enumerate(levels):
        if level is None:
            continue
        px = x0 + i * (x1 - x0) // (CHART_POINTS - 1)
        py = bottom - level * (bottom - top) // MAX_LEVEL
        points.append((px, py))
    if not points:
        return
    for guide in (top, (top + bottom) // 2):
        for gx in range(x0, x1, 8):
            draw.point((gx, guide), fill=128)
    _draw_pace_line(draw, x0, x1, top, bottom)
    if len(points) == 1:
        px, py = points[0]
        draw.rectangle((px - 1, py - 1, px + 2, py + 2), fill=0)
    else:
        draw.line(points, fill=0, width=3, joint="curve")
    draw.line((x0, bottom + 2, x1, bottom + 2), fill=0, width=1)


def _font(path, size):
    return ImageFont.truetype(path, size)


def _fit(draw, value, font, width):
    """Shorten text with dots only if it would otherwise run into its neighbour."""
    if draw.textlength(value, font=font) <= width:
        return value
    while value and draw.textlength(value + "...", font=font) > width:
        value = value[:-1]
    return value + "..."


def _draw_battery(draw, level):
    """A phone-style battery in the top right corner, drawn solid so it reads at a glance."""
    x1, top, width, height = CHART_X1, 13, 46, 20
    tip = 4
    x0 = x1 - width - tip
    draw.rectangle((x0, top, x0 + width, top + height), outline=0, width=2)
    draw.rectangle((x0 + width + 1, top + 6, x1, top + height - 6), fill=0)
    inner = width - 7
    fill = max(2, inner * level // 100) if level else 0
    if fill:
        draw.rectangle((x0 + 4, top + 4, x0 + 3 + fill, top + height - 4), fill=0)
    return (x0, top, x1, top + height)


def _draw_gcp(draw, gcp):
    """Header, then spend and credit, then a 2x2 grid of servers. Returns text boxes and server names."""
    top = GCP_TOP
    boxes = {}

    def text(name, xy, value, font, fill=0, anchor="ls"):
        draw.text(xy, value, font=font, fill=fill, anchor=anchor)
        boxes[name] = draw.textbbox(xy, value, font=font, anchor=anchor)

    bold22, regular22 = _font(FONT_BOLD, 22), _font(FONT_REGULAR, 22)
    bold16, regular16 = _font(FONT_BOLD, 16), _font(FONT_REGULAR, 16)
    bold40, bold32 = _font(FONT_BOLD, 40), _font(FONT_BOLD, 32)
    cost = gcp.cost

    draw.line((0, top, WIDTH, top), fill=0, width=2)
    text("title", (MARGIN, top + 24), "GOOGLE CLOUD", bold22)
    text("as_of", (boxes["title"][2] + 10, top + 24), f"cost as of {cost.as_of}", regular16)
    text("up", (WIDTH - MARGIN, top + 24), gcp.up_label, regular22, anchor="rs")

    strip_top, strip_bottom = top + 30, top + 100
    draw.line((0, strip_top, WIDTH, strip_top), fill=0, width=1)
    draw.line((0, strip_bottom, WIDTH, strip_bottom), fill=0, width=1)
    draw.line((WIDTH // 2, strip_top, WIDTH // 2, strip_bottom), fill=0, width=1)
    column = MARGIN + 140
    text("today_label", (MARGIN, strip_top + 20), "SPEND TODAY", bold16)
    text("spend_today", (MARGIN, strip_top + 62), cost.spend_today, bold40)
    text("month_label", (column, strip_top + 20), f"SPEND {cost.month}", bold16)
    text("spend_month", (column, strip_top + 62), cost.spend_month, bold40)
    text("credit_label", (WIDTH // 2 + MARGIN, strip_top + 20), "CREDIT LEFT", bold16)
    text("credit", (WIDTH // 2 + MARGIN, strip_top + 58), cost.credit, bold32)
    text("credit_total", (boxes["credit"][2] + 10, strip_top + 58), f"of {cost.credit_total}", regular16, fill=51)

    names = []
    cell_width, cell_height = WIDTH // 2, 50
    grid_top = strip_bottom + 1
    for i, server in enumerate(gcp.servers):
        x0 = (i % 2) * cell_width
        y0 = grid_top + (i // 2) * cell_height
        ink = 255 if server.up else 85
        if server.up:
            draw.rectangle((x0, y0, x0 + cell_width - 1, y0 + cell_height - 1), fill=0)
        if i % 2:
            # A white rule keeps two running neighbours apart; black cells would otherwise merge.
            draw.line((x0, y0, x0, y0 + cell_height - 1), fill=255 if server.up else 0, width=2 if server.up else 1)
        dot = (x0 + MARGIN, y0 + 16, x0 + MARGIN + 18, y0 + 34)
        if server.up:
            draw.ellipse(dot, fill=255)
        else:
            draw.ellipse(dot, outline=128, width=2)
        status_right = x0 + cell_width - MARGIN
        status_font = bold22 if server.up else regular22
        status_width = draw.textlength(server.status, font=status_font)
        name_x = dot[2] + 10
        name = _fit(draw, server.name, regular22, status_right - status_width - 10 - name_x)
        names.append(name)
        text(f"name{i}", (name_x, y0 + 33), name, regular22, fill=ink)
        text(f"status{i}", (status_right, y0 + 33), server.status, status_font, fill=ink, anchor="rs")
    draw.line((0, grid_top + cell_height, WIDTH, grid_top + cell_height), fill=255, width=2)
    return boxes, names


def render(cells: list[Cell], gcp, battery=None):
    """Return (image, layout). The layout's text boxes are used by tests to prove nothing overlaps."""
    image = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(image)
    bold = _font(FONT_BOLD, 28)
    regular = _font(FONT_REGULAR, 28)
    huge = _font(FONT_BOLD, 92)
    big = _font(FONT_REGULAR, 40)
    small = _font(FONT_REGULAR, 22)
    rows = []
    for row, index in enumerate(ROW_ORDER):
        cell = cells[index]
        top = row * CELL_HEIGHT
        boxes = {}

        def text(name, xy, value, font, anchor="ls"):
            draw.text(xy, value, font=font, fill=0, anchor=anchor)
            boxes[name] = draw.textbbox(xy, value, font=font, anchor=anchor)

        text("provider", (MARGIN, top + 42), cell.provider, bold)
        text("window", (boxes["provider"][2] + 10, top + 42), cell.window, regular)
        text("percent", (MARGIN - 2, top + 130), cell.percent, huge)
        text("countdown", (MARGIN, top + 180), cell.countdown, big)

        _icon_reset(draw, CHART_X0, top + 163)
        boxes["reset_icon"] = (CHART_X0, top + 163, CHART_X0 + 20, top + 183)
        text("reset", (CHART_X0 + 28, top + 181), cell.reset, small)
        updated_box = draw.textbbox((0, 0), cell.updated, font=small, anchor="ls")
        updated_x = CHART_X1 - (updated_box[2] - updated_box[0])
        _icon_updated(draw, updated_x - 28, top + 163)
        boxes["updated_icon"] = (updated_x - 28, top + 163, updated_x - 8, top + 183)
        text("updated", (updated_x, top + 181), cell.updated, small, anchor="ls")

        _draw_chart(draw, cell.chart, CHART_X0, CHART_X1, top + CHART_TOP, top + CHART_BOTTOM)
        if row:
            draw.line((12, top, WIDTH - 12, top), fill=0, width=2)
        elif battery is not None:
            boxes["battery"] = _draw_battery(draw, battery)
        rows.append({"provider": cell.provider, "window": cell.window, "boxes": boxes})
    gcp_boxes, names = _draw_gcp(draw, gcp)
    return image, {"rows": rows, "gcp": gcp_boxes, "names": names}


def png_bytes(image) -> bytes:
    # Mode L saves as true 8-bit grayscale (PNG colour type 0); eips rejects paletted files.
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def render_frame(text: str, gcp, battery=None) -> bytes:
    return png_bytes(render(parse_frame(text), gcp, battery)[0])
