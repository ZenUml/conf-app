"""Render the reMarkable board: a 1404x1872 grayscale page built from five section dicts.

Geometry follows DESIGN.md. Live data varies, so text is shortened with "…" or wrapped, never asserted.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1404, 1872
GRAY = 0x44
RAIL = 0x22  # side tabs: 0x44 reads too light on the panel
FONT_FILE = Path(__file__).resolve().parent / "fonts" / "Inter.ttf"

L, R = 56, 1348
COL2, DIV = 728, 704
BADGE = 34
LETTER = {"LITE": "L", "FULL": "F", "BOTH": "B", "DIAGRAMLY": "D", "ASYNCAPI": "A"}

# name -> (label, top, height)
SECTIONS = {
    "tokens": ("TOKENS", 0, 209),
    "customers": ("CUSTOMERS", 210, 476),
    "sites": ("NEW CUSTOMERS", 686, 336),
    "revenue": ("REVENUE", 1022, 468),
    "gcp": ("GCP", 1490, 382),
}

_fonts: dict = {}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in _fonts:
        f = ImageFont.truetype(str(FONT_FILE), size)
        f.set_variation_by_name("Bold" if bold else "Regular")
        _fonts[key] = f
    return _fonts[key]


def tlen(value: str, size: int, bold: bool = False) -> float:
    return font(size, bold).getlength(value)


def fit(value: str, size: int, bold: bool, width: float) -> str:
    """Cut with an ellipsis when the text is wider than `width`."""
    value = str(value)
    if tlen(value, size, bold) <= width:
        return value
    while value and tlen(value.rstrip() + "…", size, bold) > width:
        value = value[:-1]
    return value.rstrip() + "…"


def wrap(value: str, size: int, width: float, max_lines: int = 2) -> list[str]:
    lines, current = [], ""
    for word in str(value).split():
        trial = f"{current} {word}".strip()
        if tlen(trial, size) <= width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines - 1] + [fit(" ".join(lines[max_lines - 1:]), size, False, width - 1)]
    return [fit(line, size, False, width) for line in lines]


class Canvas:
    def __init__(self):
        self.image = Image.new("L", (WIDTH, HEIGHT), 255)
        self.d = ImageDraw.Draw(self.image)

    def text(self, x, y, value, size=24, bold=False, fill=0, anchor="ls"):
        self.d.text((x, y), str(value), font=font(size, bold), fill=fill, anchor=anchor)

    def rect(self, x, y, w, h, fill=0, outline=None, width=2):
        self.d.rectangle((round(x), round(y), round(x + w) - 1, round(y + h) - 1), fill=fill,
                         outline=outline, width=width)

    def hline(self, x0, x1, y, w=2):
        self.rect(x0, y - w // 2, x1 - x0, w)

    def vline(self, x, y0, y1, w=2):
        self.rect(x - w // 2, y0, w, y1 - y0)

    def tab(self, top, height, label):
        self.rect(0, top, 40, height, fill=RAIL)
        spacing = 3
        size = 24
        while size > 14:
            width = sum(tlen(c, size, True) + spacing for c in label) - spacing
            if width <= height - 16:
                break
            size -= 2
        tmp = Image.new("L", (int(height), 40), RAIL)
        td = ImageDraw.Draw(tmp)
        x = (height - width) / 2
        for c in label:
            td.text((x, 29), c, font=font(size, True), fill=255, anchor="ls")
            x += tlen(c, size, True) + spacing
        self.image.paste(tmp.rotate(90, expand=True), (0, int(top)))

    def badge(self, x, baseline, product):
        y = baseline - 27
        self.rect(x, y, BADGE, BADGE, fill=255, outline=0, width=2)
        self.text(x + BADGE / 2, baseline - 2, LETTER.get(product, str(product)[:1].upper()), 24, True,
                  anchor="ms")


def _icon_reset(d, x, y):
    d.arc((x + 2, y + 4, x + 17, y + 19), start=20, end=290, fill=0, width=3)
    d.polygon([(x + 13, y), (x + 19, y + 6), (x + 10, y + 9)], fill=0)


def _chart(c: Canvas, cell, x0, guide_end=None):
    """Chart box x0+170 .. x0+400, y 36..152, with the even-use diagonal and the usage curve."""
    cx0, cx1, top, bottom = x0 + 170, x0 + 400, 36, 152
    gend = guide_end or cx1
    for guide in (top, (top + bottom) // 2):
        for gx in range(cx0, gend, 8):
            c.d.point((gx, guide), fill=170)
    for x in range(cx0, cx1, 12):
        end = min(x + 6, cx1)
        at = lambda v: top + (v - cx0) * (bottom - top) / (cx1 - cx0)
        c.d.line((x, at(x), end, at(end)), fill=0, width=3)  # PIL width 2 is 1-2 px on this slope
    c.d.line((cx0, 155, cx1, 155), fill=0, width=2)
    levels = list(cell.get("chart") or [])
    peak = cell.get("max") or 50
    n = max(len(levels), 2)
    pts = [(cx0 + i * (cx1 - cx0) / (n - 1), bottom - min(max(v, 0), peak) * (bottom - top) / peak)
           for i, v in enumerate(levels) if v is not None]
    if len(pts) == 1:
        px, py = pts[0]
        c.d.rectangle((px - 2, py - 2, px + 2, py + 2), fill=0)
    elif pts:
        c.d.line(pts, fill=0, width=4, joint="curve")


STALE_AFTER = 30 * 60
MIXPANEL_STALE_AFTER = 3 * 60 * 60  # three hourly billing checks


def updated_label(sampled_at, now: datetime) -> tuple[str, bool]:
    """Last sample time as local HH:MM; over 30 minutes old it gets a STALE prefix."""
    if sampled_at is None:
        return "", False
    when = datetime.fromtimestamp(sampled_at)
    if (now - when).total_seconds() > STALE_AFTER:
        return f"STALE {when:%H:%M}", True
    return f"{when:%H:%M}", False


def draw_header(c: Canvas, data, battery, now: datetime, disk_free_gb: int | None = None):
    cells = list((data or {}).get("cells") or [])
    for i, x0 in enumerate((56, 506, 956)):
        if i >= len(cells):
            break
        cell = cells[i]
        c.text(x0, 49, fit(cell.get("name", ""), 24, True, 160), 24, True)
        c.text(x0 - 2, 110, fit(cell.get("percent", ""), 60, True, 166), 60, True)
        c.text(x0, 145, fit(cell.get("countdown", ""), 24, False, 160), 24)
        _icon_reset(c.d, x0, 158)
        c.text(x0 + 28, 177, fit(cell.get("reset", ""), 24, False, 140), 24)
        label, _ = updated_label(cell.get("sampled_at"), now)
        if label:  # right edge of the chart, on the reset row
            c.text(x0 + 400, 177, label, 24, True, anchor="rs")
        _chart(c, cell, x0, guide_end=1281 if i == 2 else None)
    c.vline(482, 30, 178)
    c.vline(932, 30, 178)
    if battery is not None:
        c.rect(1293, 32, 56, 26, fill=255, outline=0, width=3)
        c.rect(1351, 39, 5, 12, fill=0)
        fill = round(30 * max(0, min(100, battery)) / 100)
        if fill:
            c.rect(1298, 37, fill, 16, fill=0)
    if disk_free_gb is not None:
        disk_label = f"{disk_free_gb} GB"
        width = tlen(disk_label, 22, True) + 8
        c.rect(1322 - width / 2, 63, width, 24, fill=255)
        c.text(1322, 83, disk_label, 22, True, anchor="ms")


def place_label(place: str, width: float) -> str:
    """Region and country shortcode, already like `Americas / US`, cut only if the row is narrower."""
    text = str(place or "")
    if not text or width <= 24:
        return ""
    return text if tlen(text, 24) <= width else fit(text, 24, False, width)


def draw_name_place_seats(c: Canvas, nx, baseline, width, name, place, seats):
    """Name, then region/country, then the seat count. `width` ends before the next element.

    The seat count is never shortened. Name and place share what remains: both stay whole when
    they fit, otherwise the name keeps about half and the place takes the rest, each with an ellipsis.
    """
    seats = str(seats or "")
    place = str(place or "")
    seat_w = tlen(seats, 24, True) + 10 if seats else 0
    budget = max(0.0, width - seat_w)
    name_w = tlen(str(name), 30, True)
    place_w = tlen(place, 24) + 10 if place else 0
    if place and name_w + place_w > budget and budget > 40:
        name_keep = min(name_w, max(100.0, budget * 0.5))
        place_keep = budget - name_keep
    else:
        name_keep, place_keep = budget, max(0.0, budget - name_w)
    shown = fit(str(name), 30, True, name_keep)
    place_text = place_label(place, place_keep - 10) if place and place_keep > 24 else ""
    c.text(nx, baseline, shown, 30, True)
    x = nx + tlen(shown, 30, True)
    if place_text:
        c.text(x + 10, baseline, place_text, 24)
        x += tlen(place_text, 24) + 10
    if seats:
        c.text(x + 10, baseline, seats, 24, True)


def draw_customers(c: Canvas, data, top):
    rows = list((data or {}).get("rows") or [])[:5]
    x, right = L, DIV - 24
    for i, row in enumerate(rows):
        b = top + 54 + i * 90
        c.badge(x, b, row.get("product", ""))
        nx = x + BADGE + 14
        status = fit(row.get("status", ""), 24, False, 230)
        sw = tlen(status, 24)
        draw_name_place_seats(c, nx, b, right - sw - 24 - nx, row.get("name", ""),
                              row.get("place", ""), row.get("seats") or "")
        c.text(right, b, status, 24, anchor="rs")
        c.text(x, b + 38, fit(row.get("note", ""), 24, False, right - x), 24)
    c.vline(DIV, top + 22, top + 476 - 22)



def draw_mixpanel(c: Canvas, data, top, now: datetime, stale=False):
    """Two organization billing cells; graph time spans the actual full cycle."""
    data = data or {}
    local = ZoneInfo("Australia/Melbourne")
    current = now.replace(tzinfo=local) if now.tzinfo is None else now.astimezone(local)
    try:
        start = datetime.fromisoformat(data['period_start']).replace(tzinfo=local)
        end = datetime.fromisoformat(data['period_end']).replace(tzinfo=local)
        checked = datetime.fromisoformat(data['checked_at'])
        expired = current >= end
        old = stale or (current - checked).total_seconds() > MIXPANEL_STALE_AFTER
    except (KeyError, ValueError, TypeError):
        start = end = checked = None
        expired, old = False, stale
    for i, (key, label) in enumerate((("events", "MIXPANEL EVENTS"), ("session_replay", "SESSION REPLAY"))):
        y = top + 22 + i * 216
        c.text(L, y + 24, label, 24, True)
        metric = data.get(key) or {}
        available = checked is not None and not expired and 'remaining' in metric
        value = f"{metric['remaining']:.0f}%" if available else "N/A"
        c.text(L - 2, y + 90, value, 60, True)
        c.text(L, y + 122, "LEFT" if available else "PERIOD EXPIRED" if expired else "UNAVAILABLE", 24, True)
        if available:
            counts = f"{metric['used']:,.0f} / {metric['limit']:,.0f} used"
            c.text(L, y + 158, fit(counts, 24, False, DIV - 24 - L), 24)
        if end:
            c.text(L, y + 191, f"Ends {(end-timedelta(days=1)):%d %b}", 24)
        if checked:
            stamp = checked.astimezone(local)
            c.text(DIV - 24, y + 191, f"{'STALE ' if old else 'Checked '}{stamp:%d %b %H:%M}", 20, True, anchor="rs")
        if start and end:
            x0, x1 = L + 275, DIV - 24
            yt, yb = y + 48, y + 122
            for guide in (yt, (yt+yb)//2):
                for x in range(x0, x1, 8):
                    c.d.point((x, guide), fill=170)
            for x in range(x0, x1, 12):
                stop = min(x+6, x1)
                at = lambda v: yt + (v-x0)*(yb-yt)/(x1-x0)
                c.d.line((x,at(x),stop,at(stop)), fill=0, width=3)
            c.hline(x0, x1, yb+3)
            points = []
            if available:
                for point in data.get('history') or []:
                    when = datetime.fromisoformat(point['checked_at'])
                    fraction = (when-start).total_seconds()/(end-start).total_seconds()
                    if 0 <= fraction < 1:
                        points.append((x0+fraction*(x1-x0), yb-max(0,min(100,point[key]))*(yb-yt)/100))
            if len(points) > 1:
                c.d.line(points, fill=0, width=4, joint='curve')
            for x, py in points:
                c.d.ellipse((x-3,py-3,x+3,py+3), fill=0)
    c.vline(DIV, top + 22, top + 476 - 22)

def checked_text(data):
    try:
        when = datetime.fromisoformat((data or {}).get("checked_at"))
        if when.tzinfo is not None:
            when = when.astimezone()
        return f"Checked {when:%d %b %H:%M}"
    except (TypeError, ValueError):
        return "Checked —"


def draw_credits(c: Canvas, data, top, stale=False):
    """Compact AWS card above the Fullscreen follow-up list."""
    data = data or {}
    width = R - COL2
    c.text(COL2, top + 44, "AWS ACTIVATE / CREDITS", 24, True)
    status = data.get("status") or "UNAVAILABLE"
    c.text(COL2, top + 81, fit(status, 36, True, 285), 36, True)
    if data.get("requested_amount"):
        c.text(R, top + 81, fit("REQUESTED " + data["requested_amount"], 24, False, 310), 24, anchor="rs")
    if status == "PENDING":
        c.text(COL2, top + 113, "7–10 business days · No action required", 24)
    c.text(COL2, top + 139, checked_text(data) + (" · CACHE STALE" if stale else ""), 20, fill=GRAY)
    c.hline(COL2, R, top + 154)


def draw_fullscreen(c: Canvas, data, top, stale=False):
    data = data or {}
    width = R - COL2
    if not data:
        c.text(COL2, top + 188, "FULLSCREEN · UNAVAILABLE", 24, True)
        return
    title = f"{data.get('site', '')} / FULLSCREEN"
    counts = f"{data.get('active', 0)} active · {data.get('expired', 0)} expired"
    c.text(COL2, top + 188, fit(title, 24, True, 330), 24, True)
    c.text(R, top + 188, counts, 24, anchor="rs")
    rows = list(data.get("rows") or [])
    if not rows:
        c.text(COL2, top + 224, "No requests recorded", 24)
    for i, row in enumerate(rows[-4:]):
        baseline = top + 224 + i * 50
        left = f"{row.get('requested', '—')} {row.get('space', '')} {row.get('id', '')}"
        grant = row.get('grant', 'UNKNOWN')
        right = (f"TEMP to {row.get('expires', '—')}" if grant == 'ACTIVE' else
                 f"TEMP EXPIRED {row.get('expires', '—')}" if grant == 'EXPIRED' else f"TEMP {grant}")
        c.text(COL2, baseline, fit(left, 24, False, width - tlen(right, 24, True) - 12), 24)
        c.text(R, baseline, right, 24, True, anchor="rs")
        reply = row.get("mail", "Reply not recorded")
        if row.get("mail_at"):
            reply += " · " + row["mail_at"]
        c.text(COL2, baseline + 25, fit(reply, 24, False, width), 24, "BOUNCED" in reply or "FAILED" in reply)
    recorded = data.get("outcomes_recorded", 0)
    footer = f"Follow-up outcomes: {recorded} recorded" if recorded else "Follow-up outcome not recorded"
    if len(rows) > 4:
        footer += f" · showing latest 4/{len(rows)}"
    c.text(COL2, top + 426, fit(footer, 20, False, width), 20, fill=GRAY)
    c.text(COL2, top + 450, checked_text(data) + (" · CACHE STALE" if stale else ""), 20, fill=GRAY)


def draw_sites(c: Canvas, data, top):
    data = data or {}
    lb = top + 46
    c.rect(L, lb - 15, 32, 14)
    c.text(L + 42, lb, "this week", 24)
    lx = L + 42 + tlen("this week", 24) + 32
    c.rect(lx, lb - 10, 32, 5)
    c.text(lx + 42, lb, "week before", 24)
    funnel = data.get("funnel") or {}
    now, before = list(funnel.get("now") or []), list(funnel.get("before") or [])
    steps = ["Installed", "Opened", "Created", "Active 3d+", "Paid"]
    x0 = 210
    peak = max([1] + now + before)
    unit = min(38, 330 / peak)
    for j, label in enumerate(steps):
        b = top + 106 + j * 52
        n = now[j] if j < len(now) else 0
        p = before[j] if j < len(before) else 0
        c.text(L, b, label, 24)
        if n:
            c.rect(x0, b - 19, n * unit, 16)
        if p:
            c.rect(x0, b + 1, p * unit, 5)
        end = x0 + max(n, p) * unit + 14
        if j == 0:
            text = str(n)
        elif n and now and now[0]:
            text = f"{n} ({round(100 * n / now[0])}%)"
        else:
            text = str(n)
        c.text(end, b, text, 24, bool(n), fill=0 if n else GRAY)
    box, gap = 24, 8
    bx0 = R - 5 * box - 4 * gap
    rows = list(data.get("rows") or [])[:7]
    for i, row in enumerate(rows):
        b = top + 46 + i * 44
        if not row.get("recent", True) and (i == 0 or rows[i - 1].get("recent", True)):
            _dashed(c, COL2, R, b - 33)  # the last 7 days end here
        c.badge(COL2, b, row.get("product", ""))
        nx = COL2 + BADGE + 14
        draw_name_place_seats(c, nx, b, bx0 - 24 - nx, row.get("name", ""),
                              row.get("place", ""), row.get("seats") or "")
        reached = list(row.get("steps") or [])
        for j in range(5):
            x = bx0 + j * (box + gap)
            if j < len(reached) and reached[j]:
                c.rect(x, b - 22, box, box)
            else:
                c.rect(x, b - 22, box, box, fill=255, outline=0, width=1)
    c.vline(DIV, top + 22, top + 336 - 22)


def _dashed(c: Canvas, x0, x1, y):
    for x in range(x0, x1, 14):
        c.rect(x, y, min(8, x1 - x), 2, fill=GRAY)


def draw_revenue(c: Canvas, data, top):
    data = data or {}
    third = (R - L) // 3
    for x, key, label in ((L, "d30", "LAST 30 DAYS"), (L + third, "d90", "LAST 90 DAYS"),
                          (L + 2 * third, "ytd", "YEAR TO DATE")):
        value = str(data.get(key, ""))
        c.text(x, top + 60, value, 44, True)
        c.text(x + tlen(value, 44, True) + 14, top + 60, label, 24, fill=GRAY)
    c.hline(L, R, top + 86)
    rows = list(data.get("rows") or [])[:10]
    for col in range(2):
        x = L if col == 0 else COL2
        right = DIV - 24 if col == 0 else R
        for i, row in enumerate(rows[col * 5:col * 5 + 5]):
            b = top + 128 + i * 68
            c.badge(x, b, row.get("product", ""))
            nx = x + BADGE + 14
            amount = str(row.get("amount", ""))
            c.text(right, b, amount, 30, True, anchor="rs")
            c.text(nx, b, fit(row.get("name", ""), 30, True, right - nx - tlen(amount, 30, True) - 20), 30, True)
            detail = "   ".join(str(row[k]) for k in ("date", "type", "seats") if row.get(k))
            c.text(nx, b + 32, fit(detail, 24, False, right - nx), 24, fill=GRAY)
    c.vline(DIV, top + 104, top + 468 - 22)


def draw_gcp(c: Canvas, data, top):
    data = data or {}
    stats = [("TODAY", data.get("today", "")), ("YESTERDAY", data.get("yesterday", "")),
             (data.get("month_label", "MONTH"), data.get("month", "")), ("CREDIT LEFT", data.get("credit", ""))]
    for (label, value), x in zip(stats, (L, 250, 440, 630)):
        c.text(x, top + 40, label, 24, fill=GRAY)
        c.text(x, top + 92, value, 44, True)
        if label == "CREDIT LEFT" and data.get("credit_total"):
            c.text(x + tlen(str(value), 44, True) + 10, top + 92, f"of {data['credit_total']}", 24, fill=GRAY)
    daily = list(data.get("daily") or [])[-14:]
    base = top + 92
    cx0 = 900
    if daily:
        cw = (R - cx0) / 14
        peak = max([0.01] + [float(d.get("cost") or 0) for d in daily])
        for i, d in enumerate(daily):
            h = max(2, float(d.get("cost") or 0) * 64 / peak)
            c.rect(cx0 + i * cw + 3, base - h, cw - 6, h)
            if i % 2:
                c.text(cx0 + i * cw + cw / 2, base + 30, d.get("day", ""), 24, fill=GRAY, anchor="ms")
        c.hline(cx0, R, base + 1)
    cols = [("SERVER", L + 12, "ls"), ("MACHINE", 520, "ls"), ("DISK", 760, "ls"), ("STATUS", 950, "ls"),
            ("$/H", R - 12, "rs")]
    widths = [520 - 16 - (L + 12), 760 - 16 - 520, 950 - 16 - 760, R - 12 - 70 - 950, 70]
    hb = top + 164
    for label, x, a in cols:
        c.text(x, hb, label, 24, True, anchor=a)
    c.hline(L, R, hb + 12)
    keys = ["name", "machine", "disk", "status", "rate"]
    for i, s in enumerate(list(data.get("servers") or [])[:5]):
        b = hb + 46 + i * 36
        up = bool(s.get("up"))
        if up:
            c.rect(L, b - 26, R - L, 34)
        for (label, x, a), key, w in zip(cols, keys, widths):
            c.text(x, b, fit(s.get(key, ""), 24, up, w), 24, up, 255 if up else 0, a)


DRAWERS = {"customers": draw_customers, "sites": draw_sites, "revenue": draw_revenue, "gcp": draw_gcp}


def render_page(sections: dict, battery: int | None, now: datetime, stale: set[str], *,
                disk_free_gb: int | None = None) -> bytes:
    c = Canvas()
    for name, (label, top, height) in SECTIONS.items():
        section_stale = "mixpanel" in stale if name == "customers" else name in stale
        c.tab(top, height, f"{label} STALE" if section_stale else label)
        if name == "tokens":
            draw_header(c, sections.get("tokens"), battery, now, disk_free_gb)
        elif name == "customers":
            draw_mixpanel(c, sections.get("mixpanel"), top, now, "mixpanel" in stale)
            draw_credits(c, sections.get("credits"), top, "credits" in stale)
            draw_fullscreen(c, sections.get("fullscreen"), top, "fullscreen" in stale)
        elif sections.get(name):
            DRAWERS[name](c, sections[name], top)
    for y in (209, 686, 1022, 1490):
        c.hline(0, WIDTH, y)
    out = io.BytesIO()
    c.image.save(out, format="PNG", optimize=True)
    return out.getvalue()
