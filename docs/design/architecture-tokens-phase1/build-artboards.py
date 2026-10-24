#!/usr/bin/env python3
"""Generate the related-locations artboards (.dc.html) from the real mermaid SVG.

Every colour/size is lifted from the shipped viewer CSS — RelatedDiagramsFooter.vue
(circle 18px #F3F4F6/#E5E7EB, popover 8px radius + 0 8px 24px rgba(0,0,0,.12), link #0052CC,
open-actor outline 2.5px #0052CC) and OverflowMenu.vue (menu row 28px, padding 6px 10px,
radius 4px, 13px, hover #F3F4F6). The viewer has no design tokens; these are the literals.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
SVG_SRC = HERE.parent.parent.parent / 'tmp' / 'mermaid-seq.svg'
svg = SVG_SRC.read_text()

# ---- fixture data (generic; no customer content) ------------------------------------------------
# actorId -> the DISTINCT pages that hold a diagram with the same participant name.
# One row per page: a page with two related diagrams is still one row (first-version rule).
RELATED = {
    'PA':     ['Refund handling', 'Partner onboarding', 'Checkout — order flow'],
    'PAY':    ['Refund handling', 'Settlement batch', 'Chargeback flow', 'Checkout — order flow'],
    'LEDGER': ['Settlement batch', 'Month-end close'],
    'NOTIF':  ['Order status emails'],
    'DB':     ['Order search', 'Nightly archive'],
}
LABEL = {'PA': 'Partner App', 'PAY': 'Payments API', 'LEDGER': 'Ledger Service',
         'NOTIF': 'Notification Service', 'DB': 'Orders DB'}
ORDER = ['PA', 'PAY', 'LEDGER', 'NOTIF', 'DB']
PARTICIPANT_TOTAL = 7
AS_OF = '27 Aug'
CURRENT_PAGE = 'Checkout — order flow'

MANY = ['Refund handling', 'Settlement batch', 'Chargeback flow', 'Month-end close',
        'Partner onboarding', 'Order search', 'Nightly archive', 'Order status emails',
        'Dispute intake', 'Payout reconciliation']

FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
VIEWBOX = (-50, -10, 1450, 585)

HEADING = 'Also appears in'
POPOVER_WIDTH = 300
LIST_MAX_HEIGHT = 238   # eight rows and half of the ninth, so a cut row shows there is more
GUTTER = 8              # distance from the anchor, and the minimum inset from the iframe edge
CIRCLE = 16             # the count circle, centred on the participant box's bottom-right corner
BELOW = GUTTER + CIRCLE // 2   # the shell opens under the circle, not under the box


def arrow_left(container_px, box_w=150.0):
    """The arrow tracks the circle. The diagram scales with the container, the shell does not,
    so the offset is the box width in rendered px, less half the arrow and the circle's overhang."""
    return round(box_w * container_px / VIEWBOX[2] - 6.6)


CARD_PX = 736           # 760 card - 12px padding either side
FULLSCREEN_PX = 1392


# ---- geometry ------------------------------------------------------------------------------------
def actor_geom(name):
    m = re.search(r'<rect(?=[^>]*name="%s")(?=[^>]*actor-top)[^>]*>' % name, svg)
    g = lambda k: float(re.search(r'(?<![\w-])' + k + r'="([^"]+)"', m.group(0)).group(1))
    return g('x'), g('y'), g('width'), g('height')


def pct(name):
    """Percentages of the SVG box, so overlays track the diagram at any container width."""
    x, y, w, h = actor_geom(name)
    return {
        'circleLeft': (x + w - VIEWBOX[0]) / VIEWBOX[2] * 100,
        'circleTop': (y + h - VIEWBOX[1]) / VIEWBOX[3] * 100,
        'left': (x - VIEWBOX[0]) / VIEWBOX[2] * 100,
        'top': (y - VIEWBOX[1]) / VIEWBOX[3] * 100,
        'bottom': (y + h - VIEWBOX[1]) / VIEWBOX[3] * 100,
        'width': w / VIEWBOX[2] * 100,
        'height': h / VIEWBOX[3] * 100,
    }


# ---- primitives ----------------------------------------------------------------------------------
CIRCLE_BASE = ('min-width:16px; height:16px; padding:0 4px; box-sizing:border-box; display:inline-flex; '
               'align-items:center; justify-content:center; font-family:inherit; font-size:10px; '
               'font-weight:600; line-height:1; border-radius:9999px; cursor:pointer;')
CIRCLE_REST = 'color:#6B7280; background:#F3F4F6; border:1px solid #E5E7EB;'
CIRCLE_OPEN = 'color:#0052CC; background:#F3F4F6; border:1px solid #0052CC;'

ROW_STYLE = ('display:flex; align-items:center; gap:6px; box-sizing:border-box; height:28px; '
             'padding:6px 10px; border-radius:4px; font-size:13px; line-height:16px; color:#0052CC; '
             'text-decoration:none;')
# the current page is a position, not a destination: plain text, no hover, no navigation
HERE_ROW_STYLE = ROW_STYLE.replace('color:#0052CC', 'color:#172B4D') + ' cursor:default;'
TITLE_STYLE = 'min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;'
# The relation is between diagrams; the list is of pages. On the current page the page title carries
# nothing the reader cannot see, so the row states the relation instead.
HERE_TEXT = 'Another diagram on this page'
HEADING_STYLE = 'padding:2px 10px 6px; font-size:12px; line-height:16px; color:#6B7280;'
SHELL_STYLE = ('box-sizing:border-box; background:#fff; border:1px solid #E5E7EB; border-radius:8px; '
               'box-shadow:0 8px 24px rgba(0,0,0,0.12); padding:8px; text-align:left; z-index:5;')


def circle(name, count, open_=False):
    p = pct(name)
    style = (f'position:absolute; left:{p["circleLeft"]:.2f}%; top:{p["circleTop"]:.2f}%; '
             f'transform:translate(-60%, -50%); {CIRCLE_BASE} {CIRCLE_OPEN if open_ else CIRCLE_REST}')
    return (f'<button type="button" data-actor="{name}" aria-expanded="{"true" if open_ else "false"}" '
            f'style="{style}">{count}</button>')


def circles_html(names, open_actor=None):
    return ''.join(circle(n, len(RELATED[n]), open_=(n == open_actor)) for n in names)


def outline(name):
    """The open participant keeps a 2.5px #0052CC outline — this is what carries the context,
    so the popover never has to repeat the participant's name."""
    p = pct(name)
    return (f'<div style="position:absolute; left:{p["left"]:.2f}%; top:{p["top"]:.2f}%; '
            f'width:{p["width"]:.2f}%; height:{p["height"]:.2f}%; box-sizing:border-box; '
            f'border-radius:3px; outline:2.5px solid #0052CC; pointer-events:none;"></div>')


def arrow(side='top', left=None, right=None):
    edge = ('border-top:1px solid #E5E7EB; border-left:1px solid #E5E7EB; top:-6px;'
            if side == 'top' else
            'border-bottom:1px solid #E5E7EB; border-right:1px solid #E5E7EB; bottom:-6px;')
    where = f'left:{left}px;' if left is not None else f'right:{right}px;'
    return (f'<div style="position:absolute; {where} {edge} width:10px; height:10px; '
            f'background:#fff; transform:rotate(45deg);"></div>')


def ordered(pages):
    """The current page first: it is the nearest position, and the marker explains itself there."""
    return ([p for p in pages if p == CURRENT_PAGE] + [p for p in pages if p != CURRENT_PAGE])


def rows_html(pages, hover_index=None):
    out = []
    for i, title in enumerate(ordered(pages)):
        if title == CURRENT_PAGE:
            out.append(f'<li><div style="{HERE_ROW_STYLE}">'
                       f'<span style="{TITLE_STYLE}">{HERE_TEXT}</span></div></li>')
            continue
        extra = 'background:#F3F4F6; color:#0747A6; text-decoration:underline;' if i == hover_index else ''
        out.append(f'<li><a class="loc-link" href="#" style="{ROW_STYLE}{extra}">'
                   f'<span style="{TITLE_STYLE}">{title}</span></a></li>')
    return ''.join(out)


def popover_height(pages, scroll=False):
    """8px + 8px shell padding, 24px heading (16 line + 2/6 padding), 28px a row."""
    listed = min(len(pages) * 28, LIST_MAX_HEIGHT) if scroll else len(pages) * 28
    return 16 + 24 + listed


def popover(pages, position, *, arrow_html='', hover_index=None, scroll=False, width=POPOVER_WIDTH):
    listed = (f'<ul style="list-style:none; margin:0; padding:0; max-height:{LIST_MAX_HEIGHT}px; '
              f'overflow-y:auto;">' if scroll else '<ul style="list-style:none; margin:0; padding:0;">')
    return (f'<div role="dialog" aria-label="{HEADING}" data-testid="related-diagrams-popover" '
            f'style="position:absolute; {position} width:{width}px; {SHELL_STYLE}">'
            f'{arrow_html}'
            f'<div style="{HEADING_STYLE}">{HEADING}</div>'
            f'{listed}{rows_html(pages, hover_index)}</ul>'
            f'</div>')


def popover_at(name, container_px, hover_index=None):
    p = pct(name)
    return popover(RELATED[name],
                   f'left:{p["left"]:.2f}%; top:calc({p["bottom"]:.2f}% + {BELOW}px);',
                   arrow_html=arrow('top', left=arrow_left(container_px)), hover_index=hover_index)


# ---- viewer chrome (unchanged from the shipped viewer) -------------------------------------------
ICON_NODES = ('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6B7280" stroke-width="1.5" '
              'stroke-linecap="round" aria-hidden="true"><circle cx="4" cy="8" r="2"></circle>'
              '<circle cx="12" cy="4" r="2"></circle><circle cx="12" cy="12" r="2"></circle>'
              '<path d="M5.8 7L10.2 4.8M5.8 9L10.2 11.2"></path></svg>')
ICON_SOURCE = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
               'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
               '<path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"></path></svg>')
ICON_SPARK = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              '<path d="M9.8 15.4 9 18l-.8-2.6a4 4 0 0 0-2.6-2.6L3 12l2.6-.8a4 4 0 0 0 2.6-2.6L9 6l.8 2.6a4 4 0 0 0 '
              '2.6 2.6L15 12l-2.6.8a4 4 0 0 0-2.6 2.6ZM18 4l.5 1.5L20 6l-1.5.5L18 8l-.5-1.5L16 6l1.5-.5Z"></path></svg>')
ICON_FULL = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
             '<path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 '
             '0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"></path></svg>')
ICON_EDIT = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
             '<path d="m16.9 4.5 2.7 2.7M4.5 19.5h2.7l10.4-10.4a1.9 1.9 0 0 0-2.7-2.7L4.5 16.8v2.7Z"></path></svg>')

HELMET = f'''<helmet>
  <style>
    body {{ margin: 0; background: #fff; font-family: {FONT}; color: #172B4D; -webkit-font-smoothing: antialiased; }}
    a {{ color: #0052CC; text-decoration: none; }} a:hover {{ color: #0747A6; text-decoration: underline; }}
    .loc-link:hover {{ background: #F3F4F6; color: #0747A6; text-decoration: underline; }}
    code {{ font-family: {MONO}; font-size: 11px; background: #F4F5F7; border-radius: 3px; padding: 1px 4px; color: #172B4D; }}
  </style>
</helmet>'''


def toolbar(title, fullscreen=False, hover=False):
    actions_opacity = '1' if (hover or fullscreen) else '0'
    btn = ('display:inline-flex; align-items:center; gap:6px; padding:4px 8px; background:transparent; '
           'color:#374151; border:1px solid transparent; border-radius:6px; font-size:13px; font-weight:500; '
           'font-family:inherit;')
    edit = '' if fullscreen else f'<button style="{btn}">{ICON_EDIT}<span>Edit</span></button>'
    full = ('' if fullscreen else
            '<button style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; background:#0052CC; '
            f'color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:500; font-family:inherit;">'
            f'{ICON_FULL}<span>Fullscreen</span></button>')
    return (f'<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 12px; '
            f'background:#fff; border-bottom:1px solid {"#E5E7EB" if (hover or fullscreen) else "transparent"};">'
            f'<div style="display:flex; align-items:center; gap:8px; min-width:0;">'
            f'<span style="font-size:14px; font-weight:600; color:#172B4D; white-space:nowrap; overflow:hidden; '
            f'text-overflow:ellipsis; max-width:420px;">{title}</span></div>'
            f'<div style="display:flex; align-items:center; gap:4px; opacity:{actions_opacity};">{edit}'
            f'<button style="{btn}">{ICON_SOURCE}<span>Source</span></button>'
            f'<button style="{btn}">{ICON_SPARK}<span>Copy for AI</span></button>{full}</div></div>')


def related_line(shown=True):
    if not shown:
        return '<div></div>'
    return (f'<div data-testid="related-diagrams-footer" style="display:flex; align-items:center; gap:6px; '
            f'padding:8px 12px; color:#6b7280; font-size:12px;">{ICON_NODES}'
            f'<span><span style="color:#374151;">{len(RELATED)} of {PARTICIPANT_TOTAL} participants</span> '
            f'also appear in other diagrams</span></div>')


def attribution():
    return ('<footer style="padding:8px 12px; color:#6b7280; font-size:12px; text-align:right;">'
            '<span>Created by Mai Anh</span><span> · 12 colleagues viewed</span></footer>')


def make_svg(svg_id):
    return svg.replace('id="archtok"', f'id="{svg_id}"').replace('#archtok', f'#{svg_id}')


def card(svg_html, overlay='', footer_related=None, title='Checkout payment flow', width='760px', hover=False):
    footer_related = related_line() if footer_related is None else footer_related
    return (f'<div style="width:{width}; position:relative; display:block; background:#fff; border:1px solid #E5E7EB; '
            f'border-radius:8px; overflow:visible; box-shadow:0 1px 3px rgba(0,0,0,0.06);">'
            f'{toolbar(title, hover=hover)}'
            f'<div style="position:relative; background:#fff; min-height:64px; padding:8px 12px 0;">'
            f'<div style="position:relative; width:100%;">'
            f'<div style="display:flex; justify-content:center;">{svg_html}</div>{overlay}</div></div>'
            f'<div style="display:flex; align-items:center; justify-content:space-between;">'
            f'{footer_related}{attribution()}</div></div>')


def page(inner, height, script=''):
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
{script}
</body>
</html>
'''


out = HERE

# ---- 1. Default — the pointer is not on the diagram: nothing on it ------------------------------
(out / 'Default.dc.html').write_text(page(card(make_svg('at-default')), 560))

# ---- 2. Circles — the pointer is anywhere on the diagram: every related position shows its count -
(out / 'Circles.dc.html').write_text(
    page(card(make_svg('at-circles'), overlay=circles_html(ORDER), hover=True), 560))

# ---- 3. Main — a circle was clicked ---------------------------------------------------------------
MAIN_DATA = {
    name: {
        'count': len(RELATED[name]),
        'pages': ordered(RELATED[name]),
        **{k: round(v, 2) for k, v in pct(name).items()},
    }
    for name in ORDER
}
MAIN_SCRIPT = '''<script data-dc-script data-props='{"$preview":{"width":1000,"height":560}}'>
const DATA = ''' + json.dumps(MAIN_DATA, ensure_ascii=False) + ''';
const ORDER = ''' + json.dumps(ORDER) + ''';
const CIRCLE_BASE = ''' + json.dumps(CIRCLE_BASE) + ''';
const CIRCLE_REST = ''' + json.dumps(CIRCLE_REST) + ''';
const CIRCLE_OPEN = ''' + json.dumps(CIRCLE_OPEN) + ''';
const SHELL = ''' + json.dumps(SHELL_STYLE) + ''';
const CURRENT_PAGE = ''' + json.dumps(CURRENT_PAGE, ensure_ascii=False) + ''';
const BELOW = ''' + str(BELOW) + ''';

class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { onDiagram: false, open: null };
    this.onKey = (event) => {
      if (event.key === 'Escape') this.setState({ open: null });
    };
  }

  componentDidMount() {
    document.addEventListener('keydown', this.onKey);
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.onKey);
  }

  renderVals() {
    const open = this.state.open;
    const shown = this.state.onDiagram || open !== null;

    const circles = ORDER.map((id) => {
      const d = DATA[id];
      const isOpen = open === id;
      const visible = shown ? '' : ' opacity:0; pointer-events:none;';
      return {
        id,
        count: d.count,
        title: d.count + ' related positions - click to see',
        style: 'position:absolute; left:' + d.circleLeft + '%; top:' + d.circleTop + '%;'
          + ' transform:translate(-60%, -50%); ' + CIRCLE_BASE + ' '
          + (isOpen ? CIRCLE_OPEN : CIRCLE_REST) + visible,
        pick: (event) => {
          event.stopPropagation();
          this.setState({ open: isOpen ? null : id });
        },
      };
    });

    const d = open === null ? null : DATA[open];
    return {
      circles,
      enter: () => this.setState({ onDiagram: true }),
      leave: () => this.setState({ onDiagram: false }),
      closeAll: () => this.setState({ open: null }),
      stop: (event) => event.stopPropagation(),
      outline: d === null ? null : {
        style: 'position:absolute; left:' + d.left + '%; top:' + d.top + '%; width:' + d.width
          + '%; height:' + d.height + '%; box-sizing:border-box; border-radius:3px;'
          + ' outline:2.5px solid #0052CC; pointer-events:none;',
      },
      pop: d === null ? null : {
        rows: d.pages.map((title) => ({
          title,
          here: title === CURRENT_PAGE,
          away: title !== CURRENT_PAGE,
        })),
        style: 'position:absolute; left:' + d.left + '%; top:calc(' + d.bottom + '% + ' + BELOW + 'px);'
          + ' width:300px; ' + SHELL,
      },
    };
  }
}
</script>'''

MAIN_OVERLAY = '''<div onMouseEnter="{{ enter }}" onMouseLeave="{{ leave }}" onClick="{{ closeAll }}" style="position:absolute; inset:0;">
        <sc-if value="{{ outline }}" hint-placeholder-val="{{ true }}"><div style="{{ outline.style }}"></div></sc-if>
        <sc-for list="{{ circles }}" as="c" hint-placeholder-count="5"><button type="button" title="{{ c.title }}" style="{{ c.style }}" onClick="{{ c.pick }}">{{ c.count }}</button></sc-for>
        <sc-if value="{{ pop }}" hint-placeholder-val="{{ true }}">
          <div role="dialog" aria-label="''' + HEADING + '''" style="{{ pop.style }}" onClick="{{ stop }}">
            ''' + arrow('top', left=arrow_left(CARD_PX)) + '''
            <div style="''' + HEADING_STYLE + '''">''' + HEADING + '''</div>
            <ul style="list-style:none; margin:0; padding:0;">
              <sc-for list="{{ pop.rows }}" as="r" hint-placeholder-count="3"><li><sc-if value="{{ r.away }}" hint-placeholder-val="{{ true }}"><a class="loc-link" href="#" style="''' + ROW_STYLE + '''"><span style="''' + TITLE_STYLE + '''">{{ r.title }}</span></a></sc-if><sc-if value="{{ r.here }}" hint-placeholder-val="{{ false }}"><div style="''' + HERE_ROW_STYLE + '''"><span style="''' + TITLE_STYLE + '''">''' + HERE_TEXT + '''</span></div></sc-if></li></sc-for>
            </ul>
          </div>
        </sc-if>
      </div>'''

(out / 'Main.dc.html').write_text(
    page(card(make_svg('at-main'), overlay=MAIN_OVERLAY, hover=True), 560, script=MAIN_SCRIPT))

# ---- 4. PopoverSpec — the popover on its own, at 1:1 ----------------------------------------------
SPEC = [
    ('Shell', '300 wide · 8px padding · 8px radius · 1px #E5E7EB · shadow 0 8px 24px rgba(0,0,0,.12)'),
    ('Heading', '12px / 16px · #6B7280 · sentence case · no participant name, no source, no counts'),
    ('Row', '28px high · 6px 10px · 4px radius · 13px #0052CC · one page per row · truncates with an ellipsis'),
    ('This page', 'a related diagram on the current page is listed first as "Another diagram on this page" — plain #172B4D text, no link. The page title would repeat what the reader can already see'),
    ('Row hover', 'background #F3F4F6 · #0747A6 · underline — the row is the whole hit target'),
    ('Circle', '16px, centred on the participant box\'s bottom-right corner, so it never crosses the top of the diagram'),
    ('Anchor', '16px under the participant box, which is 8px under the circle; left edges aligned; the arrow follows the circle'),
    ('Overflow', 'the list stops at 238px — eight rows and part of a ninth, which shows there is more; the shell never grows past the iframe'),
    ('Open state', 'the circle turns #0052CC and the participant box keeps a 2.5px #0052CC outline'),
]
spec_rows = ''.join(
    f'<div style="display:flex; gap:12px; align-items:baseline;">'
    f'<div style="width:88px; flex:0 0 88px; font-size:12px; font-weight:600; color:#374151;">{k}</div>'
    f'<div style="font-size:12px; line-height:18px; color:#6B7280;">{v}</div></div>'
    for k, v in SPEC)

spec_inner = (
    f'<div style="width:820px; min-height:460px; box-sizing:border-box; background:#F4F5F7; padding:32px; '
    f'display:flex; gap:32px; align-items:flex-start;">'
    f'<div style="display:flex; flex-direction:column; gap:24px;">'
    f'<div style="display:flex; flex-direction:column; gap:8px;">'
    f'<div style="font-size:12px; font-weight:600; color:#6B7280;">At rest</div>'
    f'<div style="position:relative; width:300px; height:132px;">'
    f'{popover(RELATED["PA"], "left:0; top:0;")}</div></div>'
    f'<div style="display:flex; flex-direction:column; gap:8px;">'
    f'<div style="font-size:12px; font-weight:600; color:#6B7280;">Pointer on a row</div>'
    f'<div style="position:relative; width:300px; height:132px;">'
    f'{popover(RELATED["PA"], "left:0; top:0;", hover_index=1)}</div></div></div>'
    f'<div style="flex:1 1 auto; display:flex; flex-direction:column; gap:10px; padding-top:2px;">'
    f'<div style="font-size:16px; font-weight:600; color:#172B4D;">Values, lifted from the shipped viewer</div>'
    f'{spec_rows}</div></div>')

(out / 'PopoverSpec.dc.html').write_text(f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
{HELMET}
{spec_inner}
</x-dc>
</body>
</html>
''')

# ---- 5. EdgeCases — the popover stays inside the iframe -------------------------------------------
VW, VH = 440, 400


def stand_in(left=None, right=None, top=0, label='Payments API'):
    where = f'left:{left}px;' if left is not None else f'right:{right}px;'
    return (f'<div style="position:absolute; {where} top:{top}px; width:150px; height:65px; '
            f'box-sizing:border-box; background:#eaeaea; border:1px solid #666; border-radius:3px; '
            f'outline:2.5px solid #0052CC; '
            f'display:flex; align-items:center; justify-content:center; font-size:16px; color:#333;">{label}</div>')


def loose_circle(left, top, count):
    return (f'<button type="button" style="position:absolute; left:{left}px; top:{top}px; {CIRCLE_BASE} '
            f'{CIRCLE_OPEN}">{count}</button>')


def viewport(title, note, body):
    return (f'<div style="display:flex; flex-direction:column; gap:8px; width:{VW}px;">'
            f'<div style="font-size:13px; font-weight:600; color:#172B4D;">{title}</div>'
            f'<div style="font-size:12px; line-height:17px; color:#6B7280; min-height:34px;">{note}</div>'
            f'<div style="position:relative; width:{VW}px; height:{VH}px; box-sizing:border-box; background:#fff; '
            f'border:1px solid #DFE1E6; border-radius:6px; overflow:hidden;">{body}</div></div>')


# A — right edge: the shell shifts left, the arrow stays under the circle.
# 440 - 300 - 8 = 132, so the shell keeps the 8px inset the viewer applies.
a_body = (stand_in(right=24, top=40)
          + loose_circle(406, 97, len(RELATED['PAY']))
          + popover(RELATED['PAY'], f'left:132px; top:{105 + BELOW}px;', arrow_html=arrow('top', left=277)))
# B — bottom edge: no room under the circle, so the shell opens above the participant box.
# The arrow keeps the circle's column; the outlined box carries the rest of the link.
b_top = 270 - GUTTER - popover_height(RELATED['PAY'])
b_body = (stand_in(left=40, top=270)
          + loose_circle(180, 327, len(RELATED['PAY']))
          + popover(RELATED['PAY'], f'left:40px; top:{b_top}px;', arrow_html=arrow('bottom', left=143)))
# C — many positions: the list scrolls inside the shell
c_body = (stand_in(left=40, top=20)
          + loose_circle(180, 77, len(MANY))
          + popover(MANY, f'left:40px; top:{85 + BELOW}px;', arrow_html=arrow('top', left=143), scroll=True))

edge_inner = (
    f'<div style="width:1500px; min-height:540px; box-sizing:border-box; background:#F4F5F7; padding:28px 32px 32px; '
    f'display:flex; gap:40px; align-items:flex-start;">'
    f'{viewport("Near the right edge", "The shell moves left until it sits 8px inside the iframe. The arrow stays under the circle, so the link between the two never breaks.", a_body)}'
    f'{viewport("Near the bottom edge", "There is no room under the circle, so the shell opens above the participant box and the arrow moves to its lower edge. The circle stays visible, and the outlined box carries the link.", b_body)}'
    f'{viewport("Many positions", "The list scrolls inside the shell. It stops on a part-height row, so the reader can see that more rows follow.", c_body)}'
    f'</div>')

(out / 'EdgeCases.dc.html').write_text(f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
{HELMET}
{edge_inner}
</x-dc>
</body>
</html>
''')

# ---- 6. Fullscreen -------------------------------------------------------------------------------
# outline first: the circle paints over it, as it does in the interactive artboard
fs_overlay = outline('PAY') + circles_html(ORDER, open_actor='PAY') + popover_at('PAY', FULLSCREEN_PX)
fs_inner = (
    f'<div style="width:1440px; height:900px; background:#fff; display:flex; flex-direction:column; box-sizing:border-box;">'
    f'{toolbar("Checkout payment flow", fullscreen=True)}'
    f'<div style="flex:1 1 auto; display:flex; flex-direction:column; justify-content:center; min-height:0; padding:0 24px;">'
    f'<div style="position:relative; width:100%; max-width:1392px; margin:0 auto;">'
    f'<div style="display:flex; justify-content:center;">{make_svg("at-fs")}</div>{fs_overlay}</div></div>'
    f'<div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid #E5E7EB;">'
    f'{related_line()}{attribution()}</div></div>')

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

for stale in ('HoverPill.dc.html', 'PopoverOpen.dc.html'):
    (out / stale).unlink(missing_ok=True)

print('wrote', sorted(p.name for p in out.glob('*.dc.html')))
