#!/usr/bin/env python3
"""Generate docs/analysis/paywall-flow.svg following the handbook diagram rules
(gist a172c69c): orthogonal connectors anchored on edge midpoints, one arrowhead
size in user units, one stroke width, solid lines, converging edges merged into
one trunk, boxes on a shared grid with quantized heights and uniform gaps, one
documented semantic palette with arrows colored by destination, no text overflow.
"""
from pathlib import Path

OUT = Path(__file__).with_name('paywall-flow.svg')

# ---------------------------------------------------------------- palette (C1)
PALETTE = {
    # key: (border/stroke, background, meaning)
    'step':  ('#44546f', '#ffffff', 'runtime step — neutral ink'),
    'store': ('#b38600', '#fff7d6', 'storage read / write (KV, localStorage)'),
    'event': ('#0c66e4', '#e9f2ff', 'Mixpanel event'),
    'ok':    ('#1f845a', '#dcfff1', 'user proceeds'),
    'stop':  ('#ae2a19', '#ffeceb', 'user blocked / enforcement'),
}
TEXT = '#172b4d'
SUBTEXT = '#44546f'

# ---------------------------------------------------------------- grid (B1–B3)
W = 1240
LANE_X, LANE_W = 20, 1200
INNER = 20                      # B10: inner box never touches the lane border
COL_W, COL_GAP = 260, 40        # B1 shared width, B2 one horizontal gap
ROW_GAP = 40                    # B2 one vertical gap
PAD, LH = 12, 16                # B1 height = 2*PAD + lines*LH
TITLE_H = 34                    # lane title band
DIAMOND_W, DIAMOND_H = 240, 104
STROKE_BOX, STROKE_LINE = 1.5, 1.0
HEAD = 9                        # rule 7: absolute arrowhead size

def col_x(c):  # c is 1-based
    return LANE_X + INNER + (c - 1) * (COL_W + COL_GAP)

# ---------------------------------------------------------------- model
class Node:
    def __init__(self, key, col, row, kind, title, body=(), mono=(), shape='box'):
        self.key, self.col, self.row, self.kind = key, col, row, kind
        self.title = title if isinstance(title, list) else [title]
        self.body, self.mono, self.shape = list(body), list(mono), shape
        self.x = col_x(col)
        self.w = COL_W if shape == 'box' else DIAMOND_W
        if shape == 'box':
            self.h = 2 * PAD + LH * (len(self.title) + len(self.body) + len(self.mono))
        else:
            self.h = DIAMOND_H
            self.x = col_x(col) + (COL_W - DIAMOND_W) // 2
        self.y = None  # set by lane layout

    @property
    def cx(self): return self.x + self.w / 2
    @property
    def cy(self): return self.y + self.h / 2
    @property
    def top(self): return (self.cx, self.y)
    @property
    def bottom(self): return (self.cx, self.y + self.h)
    @property
    def left(self): return (self.x, self.cy)
    @property
    def right(self): return (self.x + self.w, self.cy)

class Lane:
    def __init__(self, title, nodes, extra_bottom=0):
        self.title, self.nodes = title, nodes
        self.extra_bottom = extra_bottom
        self.y = None
        self.h = None

    def layout(self, y):
        self.y = y
        rows = {}
        for n in self.nodes:
            rows.setdefault(n.row, []).append(n)
        cursor = y + TITLE_H + INNER
        self.row_top, self.row_h = {}, {}
        for r in sorted(rows):
            rh = max(n.h for n in rows[r])
            self.row_top[r], self.row_h[r] = cursor, rh
            for n in rows[r]:
                n.y = cursor + (rh - n.h) / 2      # B3: centre-y shared per row
            cursor += rh + ROW_GAP
        self.h = cursor - ROW_GAP + INNER + self.extra_bottom - y
        return self.h

    def gap_y(self, r):
        """y of the horizontal bus between row r and r+1 (middle of the gap)."""
        return self.row_top[r] + self.row_h[r] + ROW_GAP / 2

# ---------------------------------------------------------------- lanes
L1 = Lane('1 · Page load on a Lite site — the page-banner iframe resolves the paywall state', [
    Node('A1', 1, 1, 'step', 'Confluence page view',
         ['confluence:pageBanner iframe mounts', 'on every page of a Lite site']),
    Node('A2', 2, 1, 'step', 'maybeProbeSpaceAdmin()',
         ['once per 30 d per domain:space', 'writes probe marker isAdmin']),
    Node('A3', 3, 1, 'step', 'getMacroMetrics()',
         ['KV cache first, else enumerate', 'the space (collect) and write KV']),
    Node('R1', 4, 1, 'store', 'Resolve paywall state (KV)',
         ['PAYWALL_EXEMPTIONS: tenant listed', '→ paywall off for the whole site',
          'license:<cloudId>:<spaceKey>', '→ spacePaid (Bundle or extension)']),
    Node('D1', 4, 2, 'step', 'macroCount', ['diagrams in this space'], shape='diamond'),
    Node('N1', 2, 3, 'ok', '< 85 → severity none', ['no banner, no gate']),
    Node('N2', 3, 3, 'step', '85–99 → severity warn', ['banner only, editor still opens']),
    Node('N3', 4, 3, 'stop', '≥ 100 → severity block', ['banner + editor-mount gate']),
    Node('E1', 1, 4, 'event', 'Mixpanel',
         ['space_admin_active (10 % sampled)', 'paywall_gate_evaluated:',
          'gate_fired · macro_count ·', 'macro_count_source kv | collect | zero']),
    Node('TM', 2, 4, 'store', 'localStorage · TargetingMarker',
         ['per clientDomain:spaceKey; every', 'later gate reads it synchronously'],
         mono=['{severity, macroCount, spacePaid,', ' cssEnabled (paywall on),', ' updatedAt}']),
    Node('D2', 3, 4, 'step', 'decidePageBanner()', ['paywall > paywall-admin > csat'], shape='diamond'),
    Node('B1', 4, 4, 'step', "'paywall' banner",
         ['warn+ · unpaid · authored in the', 'last 30 d · not snoozed (7 d)']),
    Node('E2', 3, 5, 'event', 'Mixpanel', ['paywall_banner_shown', 'paywall_banner_dismissed']),
    Node('B2', 4, 5, 'step', "'paywall-admin' banner",
         ['space admin of an over-limit', 'space · Forge flag (prod: off)']),
    Node('B3', 4, 6, 'step', "'csat' / 'none'", ["'none' closes the iframe at once"]),
])

L2 = Lane('2 · Editor mount — the only enforcement point (Publish and the persistence layer are never gated)', [
    Node('P1', 1, 1, 'step', 'Gated entry points',
         ['slash-menu insert → page_editor_create', 'page editor / viewer Edit → page_editor',
          'fullscreen open → fullscreen_viewer', 'byline create → byline_create']),
    Node('P2', 2, 1, 'step', ['tryPageEditorPaywall() /', 'tryFullscreenViewerPaywall()'],
         ['reads TargetingMarker and the', 'space license synchronously']),
    Node('D3', 3, 1, 'step', 'shouldBlockActions?',
         ['count ≥ 100 ∧ paywall on', '∧ isLite ∧ ¬spacePaid'], shape='diamond'),
    Node('K1', 4, 1, 'ok', 'No → editor mounts', ['macro_create_started /', 'macro_edit_started']),
    Node('M1', 3, 2, 'stop', 'Yes → UpgradePrompt modal',
         ['upgrade_modal_shown; the editor', 'underneath is unusable until', 'the modal is dismissed']),
    Node('E3', 4, 2, 'event', 'Mixpanel', ['paywall_triggered', 'action_type = entry point']),
    Node('S3', 2, 3, 'store', 'localStorage · continue attempts',
         ['3 per user and space', 'was 15 before 2026-08-16'],
         mono=['paywallContinueAttempts:', ' <domain>:<space>:<accountId>']),
    Node('D4', 3, 3, 'step', 'continue attempts', ['N > 0 ?'], shape='diamond'),
    Node('K2', 4, 3, 'ok', '"Continue editing (N)"',
         ['N ← N − 1, modal closes,', 'editor usable, saves persist', 'PAYWALL_CONTINUED_EDITING']),
    Node('X1', 3, 4, 'stop', 'N = 0 → locked out',
         ['button becomes "Request extension', 'to continue editing" (disabled)']),
    Node('RL1', 2, 5, 'step', 'Rail 1 · Enterprise Bundle',
         ['$299 / space / yr, Stripe card,', 'no Confluence admin needed',
          '→ license:<cloudId>:<spaceKey>', 'paywall_bundle_cta_clicked']),
    Node('RL2', 3, 5, 'step', 'Rail 2 · Full plan (Marketplace)',
         ['covers every space; needs a', 'Confluence site admin',
          '→ manual PAYWALL_EXEMPTIONS entry', 'paywall_marketplace_cta_clicked']),
    Node('RL3', 4, 5, 'step', 'Rail 3 · Request extension (JSM)',
         ['vendor grants a temporary space', 'license (7 d, +60 d for feedback)',
          '→ same license KV record', 'extension_request_clicked']),
], extra_bottom=24)

L3 = Lane('3 · Known failure shapes (measured) and the numbers to remember', [
    Node('F1', 1, 1, 'step', 'Fail-open on the count read (#302)',
         ['KV error / collect throw → count 0', '0 ≥ 100 is false → gate silent',
          '2026-07-12 audit: ≈ 0 events on', 'revenue-relevant tenants']),
    Node('F2', 2, 1, 'step', 'Client-side counter',
         ['clearing site data / incognito', 'resets N to 3 (default)',
          'seen on 2 of 42 locked-out users']),
    Node('F3', 3, 1, 'step', 'Banner reach gaps',
         ["'paywall' needs authorship in the", 'last 30 d → most admins never see it',
          "'paywall-admin' flag off in prod", 'space admin ≠ site admin (no SKU)']),
    Node('F4', 4, 1, 'step', 'Thresholds and scope',
         ['warn 85 · block 100', '3 continue attempts · 7 d snooze',
          '30 d admin probe · Lite only', 'spot check: modal at editor mount,', 'never after Publish']),
])

LANES = [L1, L2, L3]
HEADER_H = 100
y = HEADER_H
for lane in LANES:
    y += lane.layout(y) + ROW_GAP
H = y - ROW_GAP + 60

N = {n.key: n for lane in LANES for n in lane.nodes}

# ---------------------------------------------------------------- drawing
out = []
def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="13">')
out.append('<!--')
out.append('  Semantic palette (C1). Every colored element, arrow and edge label draws from this list;')
out.append('  an arrow takes the color of the node it leads INTO (C2).')
for k, (stroke, fill, meaning) in PALETTE.items():
    out.append(f'    {k:<6} border/arrow {stroke}  background {fill}  — {meaning}')
out.append(f'    text {TEXT} / secondary {SUBTEXT} — neutral ink for text that carries no state (C3)')
out.append('-->')
out.append('<defs>')
for k, (stroke, _, _) in PALETTE.items():
    # rule 7: userSpaceOnUse + fixed size; rule 9: refX at the tip
    out.append(f'  <marker id="head-{k}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="{HEAD}" markerHeight="{HEAD}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{stroke}"/></marker>')
out.append('</defs>')
out.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff"/>')
out.append(f'<text x="{LANE_X}" y="34" font-size="20" font-weight="700" fill="{TEXT}">ZenUML Lite paywall — runtime flow (production, default-on since 2026-08-09)</text>')
out.append(f'<text x="{LANE_X}" y="54" font-size="11" fill="{SUBTEXT}">Sources: pageBanner.ts · warningBanner.ts · spaceAdminProbe.ts · mountPaywallGate.ts · continueAttempts.ts · useCustomerSuccessService.ts · MacroMetrics.ts · UpgradePrompt.vue · generated 2026-09-02</text>')
# legend (box-free text + swatches, clear of every box: B5)
lx = LANE_X
for k, (stroke, fill, meaning) in PALETTE.items():
    out.append(f'<rect x="{lx}" y="66" width="14" height="14" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE_BOX}"/>')
    label = {'step': 'runtime step', 'store': 'storage read / write', 'event': 'Mixpanel event', 'ok': 'user proceeds', 'stop': 'user blocked'}[k]
    out.append(f'<text x="{lx + 20}" y="77" font-size="11" fill="{TEXT}">{label}</text>')
    lx += 20 + 7 * len(label) + 28

def draw_lane(lane):
    out.append(f'<rect x="{LANE_X}" y="{lane.y}" width="{LANE_W}" height="{lane.h}" rx="6" fill="#f7f8f9" stroke="#dfe1e6" stroke-width="{STROKE_BOX}"/>')
    out.append(f'<text x="{LANE_X + INNER}" y="{lane.y + 23}" font-size="14" font-weight="600" fill="{TEXT}">{esc(lane.title)}</text>')

def draw_node(n):
    stroke, fill, _ = PALETTE[n.kind]
    if n.shape == 'diamond':
        pts = f'{n.cx},{n.y} {n.x + n.w},{n.cy} {n.cx},{n.y + n.h} {n.x},{n.cy}'
        out.append(f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE_BOX}"/>')
        lines = n.title + n.body
        total = len(lines) * LH
        ty = n.cy - total / 2 + LH - 4
        for i, line in enumerate(lines):
            cls = f'font-size="13" fill="{TEXT}"' if i < len(n.title) else f'font-size="11" fill="{SUBTEXT}"'
            out.append(f'<text x="{n.cx}" y="{ty + i * LH}" text-anchor="middle" {cls}>{esc(line)}</text>')
        return
    out.append(f'<rect x="{n.x}" y="{n.y}" width="{n.w}" height="{n.h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{STROKE_BOX}"/>')
    has_body = bool(n.body or n.mono)
    # T3: title-only → centred; with body → left-aligned on one margin (B7)
    anchor = 'start' if has_body else 'middle'
    tx = n.x + PAD if has_body else n.cx
    ty = n.y + PAD + LH - 4
    i = 0
    for line in n.title:
        out.append(f'<text x="{tx}" y="{ty + i * LH}" text-anchor="{anchor}" font-size="13" font-weight="600" fill="{TEXT}">{esc(line)}</text>')
        i += 1
    for line in n.mono:
        out.append(f'<text x="{tx}" y="{ty + i * LH}" text-anchor="{anchor}" font-family="Menlo, Consolas, monospace" font-size="11" fill="{TEXT}" xml:space="preserve">{esc(line)}</text>')
        i += 1
    for line in n.body:
        out.append(f'<text x="{tx}" y="{ty + i * LH}" text-anchor="{anchor}" font-size="11" fill="{SUBTEXT}">{esc(line)}</text>')
        i += 1

def poly(points, kind, head=True):
    stroke = PALETTE[kind][0]
    pts = ' '.join(f'{x:.0f},{y:.0f}' for x, y in points)
    m = f' marker-end="url(#head-{kind})"' if head else ''
    out.append(f'<polyline points="{pts}" fill="none" stroke="{stroke}" stroke-width="{STROKE_LINE}"{m}/>')

def label(x, y, text, kind, anchor='start'):
    out.append(f'<text x="{x:.0f}" y="{y:.0f}" text-anchor="{anchor}" font-size="11" fill="{PALETTE[kind][0]}">{esc(text)}</text>')

def h_edge(a, b, text=None):
    """a.right → b.left, straight (same cy by grid construction)."""
    (x1, y1), (x2, y2) = a.right, b.left
    poly([(x1, y1), (x2, y2)], b.kind)
    if text:
        label((x1 + x2) / 2, y1 - 5, text, b.kind, 'middle')

def h_edge_rev(a, b):
    """a.left → b.right (target on the left)."""
    (x1, y1), (x2, y2) = a.left, b.right
    poly([(x1, y1), (x2, y2)], b.kind)

def v_edge(a, b, text=None):
    (x1, y1), (x2, y2) = a.bottom, b.top
    poly([(x1, y1), (x2, y2)], b.kind)
    if text:
        label(x1 + 6, (y1 + y2) / 2 + 4, text, b.kind)

def split_down(src, targets, bus_y, labels=None):
    """src.bottom → bus → each target.top (distribute: different meanings)."""
    sx, sy = src.bottom
    for i, t in enumerate(targets):
        tx, ty = t.top
        pts = [(sx, sy), (sx, bus_y)] if abs(tx - sx) < 0.5 else [(sx, sy), (sx, bus_y), (tx, bus_y)]
        pts.append((tx, ty))
        poly(pts, t.kind)
        if labels and labels[i]:
            label(tx + 6, (bus_y + ty) / 2 + 4, labels[i], t.kind)

def merge_up_into(sources, target, bus_y):
    """sources.bottom → bus → ONE trunk into target.top (rule 11)."""
    tx, ty = target.top
    poly([(tx, bus_y), (tx, ty)], target.kind)            # the single trunk + head
    for s in sources:
        sx, sy = s.bottom
        pts = [(sx, sy), (sx, bus_y)] if abs(sx - tx) < 0.5 else [(sx, sy), (sx, bus_y), (tx, bus_y)]
        poly(pts, target.kind, head=False)

def fan_right(src, targets):
    """diamond right vertex → riser → each target.left (one straight, others via a riser)."""
    sx, sy = src.right
    xr = sx + COL_GAP / 2
    for t in targets:
        tx, ty = t.left
        if abs(ty - sy) < 0.5:
            poly([(sx, sy), (tx, ty)], t.kind)
        else:
            poly([(sx, sy), (xr, sy), (xr, ty), (tx, ty)], t.kind)

for lane in LANES:
    draw_lane(lane)
for lane in LANES:
    for n in lane.nodes:
        draw_node(n)

# ---- lane 1 edges
h_edge(N['A1'], N['A2']); h_edge(N['A2'], N['A3']); h_edge(N['A3'], N['R1'])
v_edge(N['R1'], N['D1'])
split_down(N['D1'], [N['N1'], N['N2'], N['N3']], L1.gap_y(2), ['< 85', '85–99', '≥ 100'])
merge_up_into([N['N1'], N['N2'], N['N3']], N['TM'], L1.gap_y(3))
h_edge_rev(N['TM'], N['E1'])
h_edge(N['TM'], N['D2'])
v_edge(N['D2'], N['E2'])
fan_right(N['D2'], [N['B1'], N['B2'], N['B3']])

# ---- lane 2 edges
h_edge(N['P1'], N['P2']); h_edge(N['P2'], N['D3'])
h_edge(N['D3'], N['K1'], 'no')
v_edge(N['D3'], N['M1'], 'yes')
h_edge(N['M1'], N['E3'])
v_edge(N['M1'], N['D4'])
h_edge(N['S3'], N['D4'])
h_edge(N['D4'], N['K2'], 'N > 0')
v_edge(N['D4'], N['X1'], 'N = 0')
split_down(N['X1'], [N['RL1'], N['RL2'], N['RL3']], L2.gap_y(4))

# ---- cross-lane feedback: rails → R1 (KV re-read on the next page load), one trunk (rule 11)
rails = [N['RL1'], N['RL2'], N['RL3']]
bus_y = L2.y + L2.h - INNER                     # inside lane 2, 24 px below the rails
xr = LANE_X + LANE_W - INNER / 2               # right margin, inside both lanes
tx, ty = N['R1'].right
for r in rails:
    sx, sy = r.bottom
    poly([(sx, sy), (sx, bus_y), (xr, bus_y)], 'store', head=False)
poly([(xr, bus_y), (xr, ty), (tx, ty)], 'store')
# floating label in the empty column-1 cell beside the rails (B5: clear of every box and line)
lx, ly = col_x(1), N['RL1'].y + PAD + LH - 4
for i, line in enumerate(['Amber loop: once a license or exemption', 'is written, the next page load re-reads', 'KV → spacePaid / paywall off → the gate', 'does not fire (rails 1–3 share one trunk).']):
    label(lx, ly + i * LH, line, 'store')

out.append('</svg>')
OUT.write_text('\n'.join(out) + '\n', encoding='utf-8')
print(f'wrote {OUT} ({W}x{H})')
