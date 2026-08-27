#!/usr/bin/env python3
"""Generate the Phase-1 viewer artboards (.dc.html) from the real mermaid SVG.

Values are lifted from the shipped viewer CSS (GenericViewer.vue, DiagramAttributionFooter.vue,
OverflowMenu.vue) — literal hex/px, no design tokens exist in the viewer.
"""
import re
from pathlib import Path

HERE = Path(__file__).parent
SVG_SRC = HERE.parent.parent.parent / 'tmp' / 'mermaid-seq.svg'
svg = SVG_SRC.read_text()

# ---- fixture data (generic; no customer content) -------------------------------------------------
# actorId -> (related count, label variants seen elsewhere)
RELATED = {
    'PA':     [('Checkout — order flow', 'VPAY', 'PartnerApp'), ('Refund handling', 'VPAY', 'Partner App'), ('Partner onboarding', 'OP', 'partner-app')],
    'PAY':    [('Checkout — order flow', 'VPAY', 'Payments API'), ('Refund handling', 'VPAY', 'PaymentsAPI'), ('Settlement batch', 'FIN', 'Payments API'), ('Chargeback flow', 'FIN', 'payments_api')],
    'LEDGER': [('Settlement batch', 'FIN', 'Ledger Service'), ('Month-end close', 'FIN', 'LedgerService')],
    'NOTIF':  [('Order status emails', 'CRM', 'Notification Service')],
    'DB':     [('Order search', 'OP', 'Orders DB'), ('Nightly archive', 'OP', 'OrdersDB')],
}
LABEL = {'PA': 'Partner App', 'PAY': 'Payments API', 'LEDGER': 'Ledger Service', 'NOTIF': 'Notification Service', 'DB': 'Orders DB'}

FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"

VIEWBOX = (-50, -10, 1450, 585)


def actor_geom(name):
    m = re.search(r'<rect(?=[^>]*name="%s")(?=[^>]*actor-top)[^>]*>' % name, svg)
    g = lambda k: float(re.search(r'(?<![\w-])' + k + r'="([^"]+)"', m.group(0)).group(1))
    return g('x'), g('y'), g('width'), g('height')


def badge(name, count):
    x, y, w, h = actor_geom(name)
    bx, by = x + w - 30, y - 8
    return (f'<g class="archtok-badge" data-actor="{name}" pointer-events="none">'
            f'<rect x="{bx}" y="{by}" width="28" height="18" rx="9" fill="#F3F4F6" stroke="#E5E7EB" stroke-width="1"></rect>'
            f'<text x="{bx + 14}" y="{by + 13}" text-anchor="middle" font-family="{FONT}" font-size="12" font-weight="600" fill="#6B7280">{count}</text></g>')


def highlight(name):
    x, y, w, h = actor_geom(name)
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" stroke="#0052CC" stroke-width="2.5" pointer-events="none"></rect>'


def badges_html(only=None):
    out = []
    for a, r in RELATED.items():
        if only is not None and a not in only:
            continue
        x, y, w, h = actor_geom(a)
        left = (x + w - VIEWBOX[0]) / VIEWBOX[2] * 100
        top = (y - VIEWBOX[1]) / VIEWBOX[3] * 100
        out.append(f'<span data-actor="{a}" title="{len(r)} related diagrams you can access — click to see" style="position:absolute; left:{left:.2f}%; top:{top:.2f}%; transform:translate(-60%, -50%); min-width:18px; height:18px; padding:0 5px; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; line-height:1; color:#6B7280; background:#F3F4F6; border:1px solid #E5E7EB; border-radius:9999px; cursor:pointer;">{len(r)}</span>')
    return ''.join(out)


def make_svg(svg_id, badges=False, highlight_actor=None):
    s = svg.replace('id="archtok"', f'id="{svg_id}"').replace('#archtok', f'#{svg_id}')
    extra = ''
    if highlight_actor:
        extra += highlight(highlight_actor)
    return s.replace('</svg>', extra + '</svg>')


def pct_left(name):
    x, y, w, h = actor_geom(name)
    return (x - VIEWBOX[0]) / VIEWBOX[2] * 100


def pct_top_below(name):
    x, y, w, h = actor_geom(name)
    return (y + h - VIEWBOX[1]) / VIEWBOX[3] * 100


ICON_NODES = ('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">'
              '<circle cx="4" cy="8" r="2"></circle><circle cx="12" cy="4" r="2"></circle><circle cx="12" cy="12" r="2"></circle>'
              '<path d="M5.8 7L10.2 4.8M5.8 9L10.2 11.2"></path></svg>')
ICON_SOURCE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"></path></svg>'
ICON_SPARK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.8 15.4 9 18l-.8-2.6a4 4 0 0 0-2.6-2.6L3 12l2.6-.8a4 4 0 0 0 2.6-2.6L9 6l.8 2.6a4 4 0 0 0 2.6 2.6L15 12l-2.6.8a4 4 0 0 0-2.6 2.6ZM18 4l.5 1.5L20 6l-1.5.5L18 8l-.5-1.5L16 6l1.5-.5Z"></path></svg>'
ICON_FULL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"></path></svg>'
ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16.9 4.5 2.7 2.7M4.5 19.5h2.7l10.4-10.4a1.9 1.9 0 0 0-2.7-2.7L4.5 16.8v2.7Z"></path></svg>'

HELMET = f'''<helmet>
  <style>
    body {{ margin: 0; background: #fff; font-family: {FONT}; color: #172B4D; -webkit-font-smoothing: antialiased; }}
    a {{ color: #0052CC; text-decoration: none; }} a:hover {{ color: #0747A6; text-decoration: underline; }}
    code {{ font-family: {MONO}; font-size: 11px; background: #F4F5F7; border-radius: 3px; padding: 1px 4px; color: #172B4D; }}
  </style>
</helmet>'''


def toolbar(title, fullscreen=False, hover=False):
    actions_opacity = '1' if (hover or fullscreen) else '0'
    edit = '' if fullscreen else f'<button style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; background:transparent; color:#374151; border:1px solid transparent; border-radius:6px; font-size:13px; font-weight:500; font-family:inherit;">{ICON_EDIT}<span>Edit</span></button>'
    full = '' if fullscreen else f'<button style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; background:#0052CC; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:500; font-family:inherit;">{ICON_FULL}<span>Fullscreen</span></button>'
    return (f'<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:#fff; border-bottom:1px solid {"#E5E7EB" if (hover or fullscreen) else "transparent"};">'
            f'<div style="display:flex; align-items:center; gap:8px; min-width:0;"><span style="font-size:14px; font-weight:600; color:#172B4D; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:420px;">{title}</span></div>'
            f'<div style="display:flex; align-items:center; gap:4px; opacity:{actions_opacity};">{edit}'
            f'<button style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; background:transparent; color:#374151; border:1px solid transparent; border-radius:6px; font-size:13px; font-weight:500; font-family:inherit;">{ICON_SOURCE}<span>Source</span></button>'
            f'<button style="display:inline-flex; align-items:center; gap:6px; padding:4px 8px; background:transparent; color:#374151; border:1px solid transparent; border-radius:6px; font-size:13px; font-weight:500; font-family:inherit;">{ICON_SPARK}<span>Copy for AI</span></button>'
            f'{full}</div></div>')


def related_line(shown=True, n_with=5, n_total=7, as_of='27 Aug'):
    if not shown:
        return '<div></div>'
    return (f'<div data-testid="related-diagrams-footer" style="display:flex; align-items:center; gap:6px; padding:8px 12px; color:#6b7280; font-size:12px;">{ICON_NODES}'
            f'<span><span style="color:#374151;">{n_with} of {n_total} participants</span> also appear in other diagrams you can access</span>'
            f'<span style="color:#9CA3AF;">· as of {as_of}</span></div>')


def attribution():
    return '<footer style="padding:8px 12px; color:#6b7280; font-size:12px; text-align:right;"><span>Created by Mai Anh</span><span> · 12 colleagues viewed</span></footer>'


def popover(actor, width=320):
    rows = ''.join(
        f'<li style="display:flex; align-items:baseline; gap:6px; min-height:28px; padding:4px 6px; border-radius:4px; font-size:13px;">'
        f'<a href="#" style="color:#0052CC; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{title}</a>'
        f'<span style="font-size:11px; color:#6B7280; background:#F3F4F6; border:1px solid #E5E7EB; border-radius:9999px; padding:0 6px; line-height:16px; white-space:nowrap;">{space}</span>'
        + (f'<span style="font-size:12px; color:#6B7280; white-space:nowrap;">as <code>{variant}</code></span>' if variant != LABEL[actor] else '')
        + '</li>'
        for title, space, variant in RELATED[actor])
    return (f'<div data-testid="related-diagrams-popover" role="dialog" aria-label="Possibly related by name" style="position:absolute; left:{pct_left(actor):.2f}%; top:calc({pct_top_below(actor):.2f}% + 8px); width:{width}px; background:#fff; border:1px solid #E5E7EB; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.12); padding:10px 10px 8px; z-index:5; text-align:left;">'
            f'<div style="position:absolute; left:18px; top:-6px; width:10px; height:10px; background:#fff; border-left:1px solid #E5E7EB; border-top:1px solid #E5E7EB; transform:rotate(45deg);"></div>'
            f'<div style="font-size:11px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; color:#6B7280; padding:0 6px;">Possibly related by name</div>'
            f'<div style="font-size:13px; font-weight:600; color:#172B4D; padding:2px 6px 6px;">{LABEL[actor]}</div>'
            f'<ul style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0;">{rows}</ul>'
            f'<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 6px 0; margin-top:4px; border-top:1px solid #E5E7EB; font-size:11px; color:#9CA3AF;"><span>Same name, not proof of the same object</span><span>as of 27 Aug</span></div>'
            f'</div>')


def card(svg_html, footer_related, popover_html='', title='Checkout payment flow', width='760px', hover=False, badges=None):
    return (f'<div style="width:{width}; position:relative; display:block; background:#fff; border:1px solid #E5E7EB; border-radius:8px; overflow:visible; box-shadow:0 1px 3px rgba(0,0,0,0.06);">'
            f'{toolbar(title, hover=hover)}'
            f'<div style="position:relative; background:#fff; min-height:64px; padding:8px 12px 0;"><div style="position:relative; width:100%;"><div style="display:flex; justify-content:center;">{svg_html}</div>{badges_html(badges) if badges else ""}{popover_html}</div></div>'
            f'<div style="display:flex; align-items:center; justify-content:space-between;">{footer_related}{attribution()}</div>'
            f'</div>')


def page(inner, height):
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
{HELMET}
<div style="width:1000px; min-height:{height}px; background:#fff; padding:32px 0 40px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; gap:16px;">
  <div style="width:760px; display:flex; flex-direction:column; gap:6px;">
    <div style="font-size:24px; font-weight:500; color:#172B4D; letter-spacing:-0.01em;">Checkout — order flow</div>
    <div style="font-size:12px; color:#6B7280;">Payments · Updated 26 Aug by Mai Anh</div>
  </div>
  {inner}
</div>
</x-dc>
</body>
</html>
'''


out = HERE
# 1. Default — nothing rendered (flag off / no related / lookup failed)
(out / 'Default.dc.html').write_text(page(card(make_svg('at-default'), related_line(shown=False)), 560))
# 2. Main — footer shown, badges on lifelines with related pages
(out / 'Main.dc.html').write_text(page(card(make_svg('at-main'), related_line()), 560))
# 2b. HoverPill — pointer over the Partner App box reveals its count pill; nothing else changes
(out / 'HoverPill.dc.html').write_text(page(card(make_svg('at-hover'), related_line(), badges=['PA']), 560))
# 3. PopoverOpen — hover on Partner App
(out / 'PopoverOpen.dc.html').write_text(page(card(make_svg('at-pop', highlight_actor='PA'), related_line(), popover('PA'), hover=True, badges=['PA']), 560))

# 4. Fullscreen — 1440×900 modal, popover on Payments API
fs_inner = (
    f'<div style="width:1440px; height:900px; background:#fff; display:flex; flex-direction:column; box-sizing:border-box;">'
    f'{toolbar("Checkout payment flow", fullscreen=True)}'
    f'<div style="flex:1 1 auto; display:flex; flex-direction:column; justify-content:center; min-height:0; padding:0 24px;">'
    f'<div style="position:relative; width:100%; max-width:1392px; margin:0 auto;"><div style="display:flex; justify-content:center;">{make_svg("at-fs", highlight_actor="PAY")}</div>{badges_html(["PAY"])}{popover("PAY", width=360)}</div>'
    f'</div>'
    f'<div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid #E5E7EB;">{related_line()}{attribution()}</div>'
    f'</div>')
(out / 'Fullscreen.dc.html').write_text(f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
{HELMET}
{fs_inner}
</x-dc>
</body>
</html>
''')
print('wrote', [p.name for p in out.glob('*.dc.html')])
