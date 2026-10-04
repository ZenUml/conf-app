// Deterministic renderer for a model-authored layout.json. The model owns every coordinate; this module draws exactly
// what the spec says and measures it against the Diagram Rules. It NEVER repairs, moves or reroutes anything and NEVER
// throws on a rule violation: violations come back as findings. Only malformed JSON or schema errors throw (SpecError).

import { isAcceptedTrunkOverlap } from './trunk.mjs';
import { denseInfo } from './dense.mjs';

export class SpecError extends Error {
  constructor(errors) {
    super(errors.map(e => `${e.path}: ${e.message}`).join('\n'));
    this.name = 'SpecError';
    this.errors = errors;
  }
}

// ---- rule constants (Diagram Rules) ----
export const TIERS = {S: [96, 40], M: [200, 80], L: [320, 120], XL: [480, 160]};
const NODE_R = 4, FILLET = 5, DECISION_FILLET = 10, INSET = 8, MARKER = 10, SHAFT = 8, PARALLEL = 10, DASH = '6 4';
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
/** One spec shape per parser shape (`parseMermaid` names), plus `decision` for the diamond / long-text hexagon. Sources: [..] rect, (..) capsule, {..} decision,
 *  [(..)] cylinder, [[..]] subroutine, ((..)) circle, (((..))) doublecircle, {{..}} hexagon, [/../] parallelogram, [\..\] parallelogram_alt, [/..\] trapezoid,
 *  [\../] trapezoid_alt, >..] asymmetric, ([..]) stadium (drawn as capsule). */
export const SPEC_SHAPES = ['rect', 'capsule', 'decision', 'cylinder', 'subroutine', 'circle', 'doublecircle', 'hexagon', 'parallelogram', 'parallelogram_alt', 'trapezoid', 'trapezoid_alt', 'asymmetric'];
/** Accepted spellings that render as the canonical shape: store = cylinder, queue = subroutine ([[..]] is a rectangle with two inset bars, not a queue
 *  cylinder), stadium = capsule (rules: a capsule/stadium node is preserved as a capsule). */
const SHAPE_ALIASES = {store: 'cylinder', queue: 'subroutine', stadium: 'capsule', 'parallelogram-alt': 'parallelogram_alt', 'trapezoid-alt': 'trapezoid_alt'};
const canonShape = s => SHAPE_ALIASES[s] ?? s;
const SHAPE_NAMES = [...SPEC_SHAPES, ...Object.keys(SHAPE_ALIASES)];
const SLANTED = ['hexagon', 'parallelogram', 'parallelogram_alt', 'trapezoid', 'trapezoid_alt', 'asymmetric'];
const TEXT_SCALE = 0.93; // the glyph table below is a per-glyph upper bound; findings use 93% of it (the auditor measures real glyphs)
export const LIMITS = {nodes: 200, edges: 400, groups: 50, points: 40, bytes: 400_000};

// Per-glyph width in em (upper bound of measured Chromium getBBox widths at 12-24px, same table as kit/svgkit.py).
const EM = {' ':.29,'!':.32,'"':.48,'#':.64,'$':.64,'%':.93,'&':.72,"'":.3,'(':.39,')':.39,'*':.48,'+':.64,',':.3,'-':.48,'.':.3,'/':.31,
  '0':.64,'1':.47,'2':.61,'3':.63,'4':.65,'5':.62,'6':.64,'7':.59,'8':.64,'9':.64,':':.3,';':.3,'<':.64,'=':.64,'>':.64,'?':.52,'@':.92,
  A:.68,B:.66,C:.72,D:.73,E:.6,F:.58,G:.75,H:.75,I:.27,J:.54,K:.66,L:.57,M:.88,N:.75,O:.78,P:.64,Q:.78,R:.66,S:.64,T:.64,U:.74,V:.68,W:.97,X:.68,Y:.66,Z:.67,
  '[':.39,'\\':.31,']':.39,'^':.64,_:.59,'`':.51,a:.56,b:.62,c:.56,d:.62,e:.58,f:.37,g:.61,h:.59,i:.25,j:.26,k:.55,l:.26,m:.88,n:.59,o:.6,p:.62,q:.61,r:.39,s:.53,
  t:.37,u:.59,v:.55,w:.78,x:.53,y:.55,z:.54,'{':.39,'|':.26,'}':.39,'~':.64};
export function measureText(text, size = 18) {
  let t = 0;
  for (const ch of String(text)) t += EM[ch] ?? (ch.codePointAt(0) > 0x2e80 ? 1 : 0.95);
  return t * size;
}
const W = (text, size) => measureText(text, size) * TEXT_SCALE;
function wrap(text, width, size) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (line && W(trial, size) > width) { lines.push(line); line = word; } else line = trial;
    }
    lines.push(line);
  }
  return lines;
}

// ---- small helpers ----
const n3 = v => `${Math.round(v * 1000) / 1000}`.replace(/^-0$/, '0');
const r1 = v => Math.round(v * 10) / 10;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const comment = s => String(s).replace(/-{2,}/g, '-').replace(/-$/, '');
const norm = s => String(s ?? '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/\s+/g, ' ').trim();
const hex6 = c => { c = c.slice(1).toLowerCase(); return c.length === 3 ? [...c].map(x => x + x).join('') : c; };
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const lum = c => { const h = hex6(c); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const EPS = 0.01;
const orth = (a, b) => Math.abs(a[1] - b[1]) < EPS && Math.abs(a[0] - b[0]) >= EPS ? 'h' : Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) >= EPS ? 'v' : null;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- schema validation (hand-written: every error carries a path) ----
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const KEYS = {
  root: ['canvas', 'palette', 'groups', 'nodes', 'edges', 'legend'],
  canvas: ['w', 'h', 'fill', 'ink', 'title', 'desc'],
  role: ['fill', 'stroke', 'text', 'meaning'],
  group: ['id', 'label', 'rect', 'role', 'subtitle'],
  node: ['id', 'group', 'shape', 'rect', 'centre', 'tier', 'text', 'role', 'align', 'font', 'variant', 'labelBox'],
  edge: ['id', 'source', 'target', 'points', 'dashed', 'role', 'label', 'trunk'],
  label: ['text', 'x', 'y', 'vertical'],
  legend: ['x', 'y', 'direction', 'gap', 'entries'],
  entry: ['kind', 'role', 'label', 'shape', 'dashed', 'x', 'y', 'length'],
};

export function validateSpec(spec) {
  const errors = [];
  const E = (path, message) => { if (errors.length < 25) errors.push({path, message}); };
  const keys = (path, o, allowed) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) E(path ? `${path}.${k}` : k, `"${k}" is not a recognised key (allowed: ${allowed.join(', ')})`); };
  const num = (path, v, what = 'a number') => isNum(v) || (E(path, `must be ${what}`), false);
  const str = (path, v) => (typeof v === 'string' && v.length > 0) || (E(path, 'must be a non-empty string'), false);
  const color = (path, v) => (typeof v === 'string' && HEX.test(v)) || (E(path, `must be a colour written #rrggbb or #rgb, got ${JSON.stringify(v)}`), false);
  const rect = (path, v, what) => (Array.isArray(v) && v.length === 4 && v.every(isNum) && v[2] > 0 && v[3] > 0) || (E(path, `must be [${what}] with positive width and height`), false);
  const point = (path, v) => (Array.isArray(v) && v.length === 2 && v.every(isNum)) || (E(path, 'must be [x, y] (two numbers)'), false);
  if (!isObj(spec)) { E('$', 'layout must be a JSON object'); return errors; }
  keys('', spec, KEYS.root);
  if (!isObj(spec.canvas)) E('canvas', 'is required: {w, h, title?, desc?, fill?, ink?}');
  else {
    keys('canvas', spec.canvas, KEYS.canvas);
    for (const k of ['w', 'h']) if (num(`canvas.${k}`, spec.canvas[k]) && (spec.canvas[k] <= 0 || spec.canvas[k] > 8000)) E(`canvas.${k}`, 'must be between 1 and 8000');
    for (const k of ['fill', 'ink']) if (spec.canvas[k] !== undefined) color(`canvas.${k}`, spec.canvas[k]);
    for (const k of ['title', 'desc']) if (spec.canvas[k] !== undefined && typeof spec.canvas[k] !== 'string') E(`canvas.${k}`, 'must be a string');
  }
  const roles = isObj(spec.palette) ? Object.keys(spec.palette) : [];
  if (!isObj(spec.palette) || !roles.length) E('palette', 'is required: {roleName: {fill, stroke, text, meaning}} with at least one role');
  else for (const [name, r] of Object.entries(spec.palette)) {
    const p = `palette.${name}`;
    if (!isObj(r)) { E(p, 'must be {fill, stroke, text, meaning}'); continue; }
    keys(p, r, KEYS.role);
    for (const k of ['fill', 'stroke', 'text']) color(`${p}.${k}`, r[k]);
    if (typeof r.meaning !== 'string' || !r.meaning.trim()) E(`${p}.meaning`, 'is required: say what this colour role means (C1)');
  }
  const roleCheck = (path, v) => { if (v !== undefined && !roles.includes(v)) E(path, `unknown palette role ${JSON.stringify(v)} (defined: ${roles.join(', ')})`); };
  const groupIds = new Set();
  if (spec.groups !== undefined) {
    if (!Array.isArray(spec.groups)) E('groups', 'must be an array');
    else if (spec.groups.length > LIMITS.groups) E('groups', `at most ${LIMITS.groups} groups`);
    else spec.groups.forEach((g, i) => {
      const p = `groups[${i}]`;
      if (!isObj(g)) { E(p, 'must be an object'); return; }
      keys(p, g, KEYS.group);
      if (str(`${p}.id`, g.id)) { if (groupIds.has(g.id)) E(`${p}.id`, `duplicate group id ${JSON.stringify(g.id)}`); groupIds.add(g.id); }
      str(`${p}.label`, g.label);
      rect(`${p}.rect`, g.rect, 'x, y, w, h');
      roleCheck(`${p}.role`, g.role);
    });
  }
  const nodeIds = new Set();
  if (!Array.isArray(spec.nodes) || !spec.nodes.length) E('nodes', 'is required: a non-empty array');
  else if (spec.nodes.length > LIMITS.nodes) E('nodes', `at most ${LIMITS.nodes} nodes`);
  else spec.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    if (!isObj(n)) { E(p, 'must be an object'); return; }
    keys(p, n, KEYS.node);
    if (str(`${p}.id`, n.id)) { if (nodeIds.has(n.id)) E(`${p}.id`, `duplicate node id ${JSON.stringify(n.id)}`); nodeIds.add(n.id); }
    if (n.shape !== undefined && !SHAPE_NAMES.includes(n.shape)) E(`${p}.shape`, `must be one of ${SPEC_SHAPES.join(', ')} (aliases: ${Object.entries(SHAPE_ALIASES).map(([a, b]) => `${a}=${b}`).join(', ')})`);
    if (n.tier !== undefined && !TIERS[n.tier]) E(`${p}.tier`, `must be one of ${Object.keys(TIERS).join(', ')}`);
    if (n.rect === undefined && n.centre === undefined) E(p, 'needs "rect": [x, y, w, h] or "centre": [cx, cy] together with "tier"');
    else if (n.rect !== undefined && n.centre !== undefined) E(p, 'give either "rect" or "centre"+"tier", not both');
    else if (n.rect !== undefined) rect(`${p}.rect`, n.rect, 'x, y, w, h');
    else { point(`${p}.centre`, n.centre); if (n.tier === undefined) E(`${p}.tier`, '"centre" needs a "tier" (S, M, L, XL)'); }
    if (!(typeof n.text === 'string' && n.text.length || Array.isArray(n.text) && n.text.length && n.text.every(t => typeof t === 'string'))) E(`${p}.text`, 'must be a string or an array of line strings');
    roleCheck(`${p}.role`, n.role);
    if (n.group !== undefined && n.group !== null && !groupIds.has(n.group)) E(`${p}.group`, `unknown group ${JSON.stringify(n.group)}${groupIds.size ? ` (defined: ${[...groupIds].join(', ')})` : ' (no groups are defined)'}`);
    if (n.align !== undefined && !['center', 'left'].includes(n.align)) E(`${p}.align`, 'must be center or left');
    if (n.font !== undefined && !(isNum(n.font) && n.font >= 10 && n.font <= 32)) E(`${p}.font`, 'must be a number between 10 and 32');
    if (n.variant !== undefined && !['diamond', 'hexagon'].includes(n.variant)) E(`${p}.variant`, 'must be diamond or hexagon');
    if (n.labelBox !== undefined) rect(`${p}.labelBox`, n.labelBox, 'x, y, w, h');
  });
  if (spec.edges !== undefined) {
    if (!Array.isArray(spec.edges)) E('edges', 'must be an array');
    else if (spec.edges.length > LIMITS.edges) E('edges', `at most ${LIMITS.edges} edges`);
    else {
      const ids = new Set();
      spec.edges.forEach((e, i) => {
        const p = `edges[${i}]`;
        if (!isObj(e)) { E(p, 'must be an object'); return; }
        keys(p, e, KEYS.edge);
        if (e.id !== undefined && str(`${p}.id`, e.id)) { if (ids.has(e.id)) E(`${p}.id`, `duplicate edge id ${JSON.stringify(e.id)}`); ids.add(e.id); }
        // An endpoint is a node id or, for a Mermaid node-to-group relation (`A --> SomeGroup`), a group id.
        for (const k of ['source', 'target']) if (str(`${p}.${k}`, e[k]) && !nodeIds.has(e[k]) && !groupIds.has(e[k])) E(`${p}.${k}`, `unknown node ${JSON.stringify(e[k])} (neither a node id nor a group id)`);
        if (!Array.isArray(e.points) || e.points.length < 2) E(`${p}.points`, 'must be an array of at least 2 [x, y] points, including both endpoints');
        else if (e.points.length > LIMITS.points) E(`${p}.points`, `at most ${LIMITS.points} points`);
        else e.points.forEach((pt, j) => point(`${p}.points[${j}]`, pt));
        if (e.dashed !== undefined && typeof e.dashed !== 'boolean') E(`${p}.dashed`, 'must be true or false');
        roleCheck(`${p}.role`, e.role);
        if (e.trunk !== undefined) str(`${p}.trunk`, e.trunk);
        if (e.label !== undefined) {
          if (!isObj(e.label)) E(`${p}.label`, 'must be {text, x, y, vertical?} (x, y = centre of the label pill)');
          else {
            keys(`${p}.label`, e.label, KEYS.label); str(`${p}.label.text`, e.label.text); num(`${p}.label.x`, e.label.x); num(`${p}.label.y`, e.label.y);
            if (e.label.vertical !== undefined && typeof e.label.vertical !== 'boolean') E(`${p}.label.vertical`, 'must be true or false (true draws the label rotated -90 degrees, reading bottom to top)');
          }
        }
      });
    }
  }
  if (spec.legend !== undefined) {
    const lg = spec.legend, p = 'legend';
    if (!isObj(lg)) E(p, 'must be {x, y, entries: [...]}');
    else {
      keys(p, lg, KEYS.legend); num(`${p}.x`, lg.x); num(`${p}.y`, lg.y);
      if (lg.direction !== undefined && !['down', 'right'].includes(lg.direction)) E(`${p}.direction`, 'must be down or right');
      if (lg.gap !== undefined) num(`${p}.gap`, lg.gap);
      if (!Array.isArray(lg.entries)) E(`${p}.entries`, 'must be an array');
      else lg.entries.forEach((en, i) => {
        const q = `${p}.entries[${i}]`;
        if (!isObj(en)) { E(q, 'must be an object'); return; }
        keys(q, en, KEYS.entry);
        if (!['node', 'line'].includes(en.kind)) E(`${q}.kind`, 'must be node or line');
        str(`${q}.label`, en.label);
        if (en.role === undefined) E(`${q}.role`, 'is required'); else roleCheck(`${q}.role`, en.role);
        if (en.shape !== undefined && !SHAPE_NAMES.includes(en.shape)) E(`${q}.shape`, `must be one of ${SPEC_SHAPES.join(', ')} (aliases: ${Object.entries(SHAPE_ALIASES).map(([a, b]) => `${a}=${b}`).join(', ')})`);
        for (const k of ['x', 'y', 'length']) if (en[k] !== undefined) num(`${q}.${k}`, en[k]);
      });
    }
  }
  return errors;
}

// ---- geometry ----
function toward(v, o, r) { const l = dist(v, o), t = Math.min(r, l / 3) / l; return [v[0] + (o[0] - v[0]) * t, v[1] + (o[1] - v[1]) * t]; }
const roundedPolygon = (pts, r = DECISION_FILLET) => {
  const n = pts.length, before = pts.map((p, i) => toward(p, pts[(i + n - 1) % n], r)), after = pts.map((p, i) => toward(p, pts[(i + 1) % n], r));
  let d = `M ${n3(after[0][0])},${n3(after[0][1])}`;
  for (let i = 1; i <= n; i++) { const j = i % n; d += ` L ${n3(before[j][0])},${n3(before[j][1])} Q ${n3(pts[j][0])},${n3(pts[j][1])} ${n3(after[j][0])},${n3(after[j][1])}`; }
  return d + ' Z';
};
// dense sample of the visible filleted outline of a polygon
function outlineSamples(pts, r = DECISION_FILLET) {
  const n = pts.length, before = pts.map((p, i) => toward(p, pts[(i + n - 1) % n], r)), after = pts.map((p, i) => toward(p, pts[(i + 1) % n], r)), out = [];
  for (let i = 0; i < n; i++) {
    const a = after[i], b = before[(i + 1) % n], v = pts[(i + 1) % n], c = after[(i + 1) % n];
    const len = dist(a, b);
    for (let s = 0; s <= Math.max(1, Math.ceil(len / 0.5)); s++) { const t = Math.min(1, s * 0.5 / (len || 1)); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    for (let s = 1; s <= 12; s++) { const t = s / 12, u = 1 - t; out.push([u * u * b[0] + 2 * u * t * v[0] + t * t * c[0], u * u * b[1] + 2 * u * t * v[1] + t * t * c[1]]); }
  }
  return out;
}
const inPoly = (x, y, poly) => { let inside = false; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside; } return inside; };

const polySamples = pts => {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], len = dist(a, b), steps = Math.max(1, Math.ceil(len / 0.5));
    for (let k = 0; k < steps; k++) out.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
  }
  return out;
};
const ellipsePoints = (cx, cy, rx, ry, count) => Array.from({length: count}, (_, i) => { const t = 2 * Math.PI * i / count; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; });
// h/3 skew of the parallelograms and trapezoids, h/4 point depth of the hexagon and the flag notch
const slantOf = (shape, h) => shape === 'hexagon' || shape === 'asymmetric' ? h / 4 : h / 3;
function slantedPolygon(shape, x, y, w, h) {
  const s = slantOf(shape, h);
  switch (shape) {
    case 'hexagon': return [[x + s, y], [x + w - s, y], [x + w, y + h / 2], [x + w - s, y + h], [x + s, y + h], [x, y + h / 2]];
    case 'parallelogram': return [[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]];
    case 'parallelogram_alt': return [[x, y], [x + w - s, y], [x + w, y + h], [x + s, y + h]];
    case 'trapezoid': return [[x + s, y], [x + w - s, y], [x + w, y + h], [x, y + h]];
    case 'trapezoid_alt': return [[x, y], [x + w, y], [x + w - s, y + h], [x + s, y + h]];
    default: return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + s, y + h / 2]]; // asymmetric: flag with a notch in the left side
  }
}

function layoutNode(n, roles, defaultRole) {
  const shape = canonShape(n.shape ?? 'rect'), tier = n.tier ? TIERS[n.tier] : null;
  let x, y, w, h, variant = shape;
  if (shape === 'decision') variant = n.variant ?? (n.rect ? (n.rect[2] <= 216.5 ? 'diamond' : 'hexagon') : n.tier === 'S' ? 'diamond' : 'hexagon');
  const round = shape === 'circle' || shape === 'doublecircle', ring = shape === 'doublecircle' ? 36 : 24; // circle: 12 clear of the label box corners; doublecircle: the inner ring adds 12 more
  if (n.rect) [x, y, w, h] = n.rect;
  else {
    const [lw, lh] = tier, diag = Math.ceil(Math.hypot(lw, lh)), hh = lh + 24;
    [w, h] = shape === 'decision' ? (variant === 'diamond' ? [2 * lw + 24, 2 * lh + 24] : [lw + 80, lh + 60])
      : shape === 'cylinder' ? [lw + 24, lh + 64] : shape === 'subroutine' ? [lw + 48, lh + 24]
      : round ? [diag + ring, diag + ring]
      : shape === 'asymmetric' ? [lw + slantOf(shape, hh) + 24, hh]
      : SLANTED.includes(shape) ? [lw + 2 * slantOf(shape, hh) + 24, hh] : [lw + 2 * INSET, lh + 2 * INSET];
    x = n.centre[0] - w / 2; y = n.centre[1] - h / 2;
  }
  let lb;
  if (shape === 'decision' && variant === 'diamond') { const lw = (w - 24) / 2, lh = (h - 24) / 2; lb = [x + (w - lw) / 2, y + (h - lh) / 2, lw, lh]; }
  else if (shape === 'decision') lb = [x + 40, y + 30, w - 80, h - 60];
  else if (shape === 'cylinder') lb = [x + 12, y + 32, w - 24, h - 64]; // the lid arc dips to y+24: keep the label box below its stroke
  else if (shape === 'subroutine') lb = [x + 24, y + 12, w - 48, h - 24]; // the bars stand 12 inside the sides: the label box starts 12 beyond them
  else if (round) {
    if (tier) lb = [x + (w - tier[0]) / 2, y + (h - tier[1]) / 2, tier[0], tier[1]];
    else { const lw = Math.floor((w - ring) / Math.SQRT2), lh = Math.floor((h - ring) / Math.SQRT2); lb = [x + (w - lw) / 2, y + (h - lh) / 2, lw, lh]; } // inscribed box, corners 12 inside the outline
  }
  else if (shape === 'asymmetric') lb = [x + slantOf(shape, h) + 12, y + 12, w - slantOf(shape, h) - 24, h - 24];
  else if (SLANTED.includes(shape)) lb = [x + slantOf(shape, h) + 12, y + 12, w - 2 * slantOf(shape, h) - 24, h - 24];
  else lb = [x + INSET, y + INSET, w - 2 * INSET, h - 2 * INSET];
  if (n.labelBox && shape !== 'rect' && shape !== 'capsule') lb = n.labelBox;
  let polygon = [], outline = null, faceDot = 0;
  if (variant === 'diamond') polygon = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
  else if (variant === 'hexagon' && shape === 'decision') polygon = [[x + w / 2, y], [x + w, y + 20], [x + w, y + h - 20], [x + w / 2, y + h], [x, y + h - 20], [x, y + 20]];
  if (polygon.length) outline = outlineSamples(polygon);
  else if (SLANTED.includes(shape)) { polygon = slantedPolygon(shape, x, y, w, h); outline = polySamples(polygon); faceDot = 0.5; }
  else if (round) {
    polygon = ellipsePoints(x + w / 2, y + h / 2, w / 2, h / 2, 96);
    outline = ellipsePoints(x + w / 2, y + h / 2, w / 2, h / 2, Math.max(96, Math.ceil(Math.PI * (w + h) / 2 / 0.5)));
    faceDot = 0.95; // a leg must leave a circle along (nearly) a cardinal radius, as the auditor's ports are the four apexes
  }
  const role = roles[n.role ?? defaultRole];
  return {id: n.id, group: n.group ?? null, shape, variant, x, y, w, h, lb, polygon, outline, faceDot, role, roleName: n.role ?? defaultRole,
    text: n.text, align: n.align ?? 'center', font: n.font ?? 18, autoFont: n.font === undefined, tier: n.tier ?? null, explicitLabelBox: !!(n.labelBox && shape !== 'rect' && shape !== 'capsule')};
}
const bbox = n => [n.x, n.y, n.w, n.h];
const boxOverlap = (a, b, pad = 0) => a[0] < b[0] + b[2] + pad && a[0] + a[2] > b[0] - pad && a[1] < b[1] + b[3] + pad && a[1] + a[3] > b[1] - pad;
const rectOf = (n) => ({x: n[0], y: n[1], w: n[2], h: n[3]});

function nodeOutlineGap(n, p) {
  if (n.outline) { let best = Infinity, at = null; for (const q of n.outline) { const d = dist(p, q); if (d < best) { best = d; at = q; } } return {gap: best, at}; }
  const [x, y, w, h] = bbox(n), dx = Math.max(x - p[0], 0, p[0] - (x + w)), dy = Math.max(y - p[1], 0, p[1] - (y + h));
  if (dx > 0 || dy > 0) return {gap: Math.hypot(dx, dy), at: [Math.min(Math.max(p[0], x), x + w), Math.min(Math.max(p[1], y), y + h)]};
  const sides = [[p[0] - x, [x, p[1]]], [x + w - p[0], [x + w, p[1]]], [p[1] - y, [p[0], y]], [y + h - p[1], [p[0], y + h]]].sort((a, b) => a[0] - b[0]);
  return {gap: sides[0][0], at: sides[0][1]};
}
function outwardNormal(n, p) {
  const [x, y, w, h] = bbox(n), c = [[Math.abs(p[1] - y), [0, -1]], [Math.abs(p[1] - y - h), [0, 1]], [Math.abs(p[0] - x), [-1, 0]], [Math.abs(p[0] - x - w), [1, 0]]].sort((a, b) => a[0] - b[0]);
  return c[0][1];
}
// Outward unit normal of the polygon edge nearest to p (polygon nodes other than the decision diamond/hexagon)
function faceNormal(n, p) {
  const pts = n.polygon, area = pts.reduce((t, a, i) => { const b = pts[(i + 1) % pts.length]; return t + a[0] * b[1] - b[0] * a[1]; }, 0);
  let best = Infinity, nrm = [0, -1];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), d = dist(p, [a[0] + dx * t, a[1] + dy * t]);
    if (d < best - 1e-9) { best = d; const l = Math.sqrt(l2); nrm = area > 0 ? [dy / l, -dx / l] : [-dy / l, dx / l]; }
  });
  return nrm;
}
function nodeContains(n, x, y) { return n.polygon.length ? inPoly(x, y, n.polygon) : x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h; }

// ---- route analysis: draws exactly the points given ----
function analyseRoute(raw, add, id) {
  let pts = [];
  for (const p of raw) { if (pts.length && dist(p, pts[pts.length - 1]) < EPS) add('degenerate-route', 'minor', [id], regionOf(raw), `duplicate point (${p[0]}, ${p[1]}) in points`, 'no repeated points', 'remove the repeated point'); else pts.push([p[0], p[1]]); }
  if (pts.length < 2) { add('degenerate-route', 'blocking', [id], regionOf(raw), 'fewer than 2 distinct points', 'at least 2', 'give the route its start and end points'); return null; }
  for (let i = 0; i + 1 < pts.length; i++) if (!orth(pts[i], pts[i + 1])) {
    const a = pts[i], b = pts[i + 1];
    add('orthogonal', 'blocking', [id], regionOf([a, b]), `segment (${a[0]}, ${a[1]}) -> (${b[0]}, ${b[1]}) has dx=${r1(Math.abs(b[0] - a[0]))}, dy=${r1(Math.abs(b[1] - a[1]))}`, 'every segment horizontal or vertical (rule 3)', `insert a corner point at (${b[0]}, ${a[1]}) or (${a[0]}, ${b[1]})`);
  }
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (out.length >= 2) {
      const o = out[out.length - 2], a = out[out.length - 1], ax = orth(o, a), bx = orth(a, p);
      if (ax && ax === bx) {
        const dot = (a[0] - o[0]) * (p[0] - a[0]) + (a[1] - o[1]) * (p[1] - a[1]);
        if (dot < 0) add('reversal', 'blocking', [id], regionOf([o, a, p]), `route doubles back over itself at (${a[0]}, ${a[1]})`, 'no collinear reversal (rule 3/12)', 'remove the out-and-back detour');
        else { out[out.length - 1] = p; continue; }
      }
    }
    out.push(p);
  }
  const n = out.length, legAxis = [];
  for (let i = 0; i + 1 < n; i++) legAxis.push(orth(out[i], out[i + 1]));
  const len = i => dist(out[i], out[i + 1]);
  const isBend = Array(n).fill(false);
  for (let i = 1; i < n - 1; i++) isBend[i] = !!legAxis[i - 1] && !!legAxis[i] && legAxis[i - 1] !== legAxis[i];
  const trim = Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) if (isBend[i]) {
    const avail = j => len(j) / (((j > 0 && isBend[j]) ? 1 : 0) + ((j + 1 < n - 1 && isBend[j + 1]) ? 1 : 0) || 1);
    trim[i] = Math.min(FILLET, avail(i - 1), avail(i));
    if (trim[i] < FILLET - 1e-9) add('fillet-room', 'blocking', [id], regionOf([out[i - 1], out[i], out[i + 1]]), `bend at (${out[i][0]}, ${out[i][1]}) has room for r=${r1(trim[i])} (legs ${r1(len(i - 1))} and ${r1(len(i))})`, `uniform r=${FILLET} fillets need each leg between two bends >= ${2 * FILLET} and a leg next to one bend >= ${FILLET}`, 'lengthen the short leg or merge the two bends');
  }
  let d = `M ${n3(out[0][0])},${n3(out[0][1])}`;
  const unit = (a, b) => { const l = dist(a, b); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  for (let i = 1; i < n - 1; i++) {
    if (isBend[i] && trim[i] > 0) {
      const u = unit(out[i], out[i - 1]), v = unit(out[i], out[i + 1]), t = trim[i];
      d += ` L ${n3(out[i][0] + u[0] * t)},${n3(out[i][1] + u[1] * t)} Q ${n3(out[i][0])},${n3(out[i][1])} ${n3(out[i][0] + v[0] * t)},${n3(out[i][1] + v[1] * t)}`;
    } else d += ` L ${n3(out[i][0])},${n3(out[i][1])}`;
  }
  d += ` L ${n3(out[n - 1][0])},${n3(out[n - 1][1])}`;
  const spans = [];
  for (let i = 0; i + 1 < n; i++) {
    const ax = legAxis[i]; if (!ax) continue;
    const a = out[i], b = out[i + 1], s = Math.sign(ax === 'h' ? b[0] - a[0] : b[1] - a[1]);
    const start = (ax === 'h' ? a[0] : a[1]) + s * trim[i], end = (ax === 'h' ? b[0] : b[1]) - s * trim[i + 1];
    const lo = Math.min(start, end), hi = Math.max(start, end);
    if (hi - lo > 1e-6) spans.push({axis: ax, fixed: ax === 'h' ? a[1] : a[0], lo, hi, end});
  }
  return {pts: out, d, spans, bends: isBend.filter(Boolean).length, lastTrim: trim[n - 2] ?? 0, legAxis, len};
}
function regionOf(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  return {x: r1(x), y: r1(y), w: r1(Math.max(...xs) - x), h: r1(Math.max(...ys) - y)};
}
const spanBox = s => s.axis === 'h' ? [s.lo, s.fixed, s.hi - s.lo, 0] : [s.fixed, s.lo, 0, s.hi - s.lo];
function spanHitsBox(s, box, guard = 0) {
  const [x, y, w, h] = box;
  if (s.axis === 'h') return s.fixed > y + guard && s.fixed < y + h - guard && Math.min(s.hi, x + w - guard) - Math.max(s.lo, x + guard) > 1e-6;
  return s.fixed > x + guard && s.fixed < x + w - guard && Math.min(s.hi, y + h - guard) - Math.max(s.lo, y + guard) > 1e-6;
}
function segRectDist(a, b, [x, y, w, h]) {
  const inside = p => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h;
  if (inside(a) || inside(b)) return 0;
  const pointSeg = (p, s, t) => { const dx = t[0] - s[0], dy = t[1] - s[1], l2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2)); return dist(p, [s[0] + dx * u, s[1] + dy * u]); };
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const edges = corners.map((c, i) => [c, corners[(i + 1) % 4]]);
  const cross = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) return false; const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  if (edges.some(([c, d]) => cross(a, b, c, d))) return 0;
  return Math.min(...corners.map(c => pointSeg(c, a, b)), pointSeg(a, ...edges[0]), ...edges.flatMap(([c, d]) => [pointSeg(a, c, d), pointSeg(b, c, d)]));
}
const polyDist = (pts, box) => { let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, segRectDist(pts[i], pts[i + 1], box)); return m; };

// ---- font-fill rule: a primary label uses the largest whole font (14-28) at which its text fits its labelBox;
// comparable nodes (same tier or labelBox size, same role) share the smallest of their maxima ----
export const FONT_MIN = 14, FONT_MAX = 28;
function fitsAt(node, size) {
  const lines = Array.isArray(node.text) ? node.text : wrap(node.text, node.lb[2], size);
  const lh = Math.round(size * 1.1);
  return (lines.length - 1) * lh + 1.2 * size <= node.lb[3] + 1e-6 && Math.max(...lines.map(l => W(l, size))) <= node.lb[2] + 1e-6;
}
function maxFont(node) {
  for (let size = FONT_MAX; size >= FONT_MIN; size--) if (fitsAt(node, size)) return size;
  return FONT_MIN;
}
function assignAutoFonts(nodes) {
  const peers = new Map();
  for (const n of nodes) if (n.autoFont) {
    const key = `${n.tier ?? n.lb.slice(2).map(Math.round).join('x')}|${n.roleName}`;
    peers.set(key, Math.min(peers.get(key) ?? FONT_MAX, maxFont(n)));
    n.peerKey = key;
  }
  for (const n of nodes) if (n.autoFont) n.font = peers.get(n.peerKey);
}

// ---- text layout ----
function nodeLines(node) {
  const lbw = node.lb[2];
  return Array.isArray(node.text) ? node.text : wrap(node.text, lbw, node.font);
}
function textSvg(lines, lb, node) {
  const lh = Math.round(node.font * 1.1), cy = lb[1] + lb[3] / 2, first = cy - (lines.length - 1) * lh / 2;
  const left = node.align === 'left', x = left ? lb[0] : lb[0] + lb[2] / 2;
  return lines.map((l, i) => `<text x="${n3(x)}" y="${n3(first + i * lh)}" text-anchor="${left ? 'start' : 'middle'}" dominant-baseline="central" font-size="${n3(node.font)}" font-weight="400" fill="${node.role.text}" data-role="label">${esc(l)}</text>`).join('');
}
function nodeSvg(node) {
  const {x, y, w, h, shape, variant, role} = node, paint = `fill="${role.fill}" stroke="${role.stroke}" stroke-width="2"`;
  let outline;
  if (shape === 'rect') outline = `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" rx="${NODE_R}" ${paint}/>`;
  else if (shape === 'capsule') outline = `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" rx="${n3(h / 2)}" ${paint}/>`;
  else if (shape === 'decision') outline = `<path d="${roundedPolygon(node.polygon)}" ${paint} stroke-linejoin="round"/>`;
  else if (shape === 'cylinder') {
    const d = `M ${n3(x)} ${n3(y + 12)} C ${n3(x)} ${n3(y - 4)} ${n3(x + w)} ${n3(y - 4)} ${n3(x + w)} ${n3(y + 12)} L ${n3(x + w)} ${n3(y + h - 12)} C ${n3(x + w)} ${n3(y + h + 4)} ${n3(x)} ${n3(y + h + 4)} ${n3(x)} ${n3(y + h - 12)} Z`;
    const cap = `M ${n3(x)} ${n3(y + 12)} C ${n3(x)} ${n3(y + 28)} ${n3(x + w)} ${n3(y + 28)} ${n3(x + w)} ${n3(y + 12)}`;
    outline = `<path d="${d}" ${paint}/><path d="${cap}" fill="none" stroke="${role.stroke}" stroke-width="2"/>`;
  } else if (shape === 'subroutine') { // a rectangle with an inset vertical bar 12 inside each side
    const bars = `M ${n3(x + 12)} ${n3(y)} L ${n3(x + 12)} ${n3(y + h)} M ${n3(x + w - 12)} ${n3(y)} L ${n3(x + w - 12)} ${n3(y + h)}`;
    outline = `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" rx="${NODE_R}" ${paint}/><path d="${bars}" fill="none" stroke="${role.stroke}" stroke-width="2"/>`;
  } else if (shape === 'circle' || shape === 'doublecircle') {
    // an <ellipse> even when rx = ry: the auditor's node-stroke checks (route endpoints, intrusion) select rect, path, ellipse and polygon, not circle
    const cx = x + w / 2, cy = y + h / 2, ell = (rx, ry, extra) => `<ellipse cx="${n3(cx)}" cy="${n3(cy)}" rx="${n3(rx)}" ry="${n3(ry)}" ${extra}/>`;
    outline = ell(w / 2, h / 2, paint) + (shape === 'doublecircle' ? ell(w / 2 - 6, h / 2 - 6, `fill="none" stroke="${role.stroke}" stroke-width="2"`) : '');
  } else outline = `<polygon points="${node.polygon.map(q => `${n3(q[0])},${n3(q[1])}`).join(' ')}" ${paint} stroke-linejoin="round"/>`;
  const parent = node.group ? ` data-parent-group="${esc(node.group)}"` : '';
  return `<g data-node="${esc(node.id)}"${parent} data-shape="${variant}" data-label-box="${node.lb.map(n3).join(' ')}">${outline}${textSvg(node.lines, node.lb, node)}</g>`;
}
const ARROW_LEN = 10, ARROW_W = 10; // the marker below: 10 along the leg (refX = 10 puts the tip on the route end), 10 wide
const markerDef = c => `<marker id="arrow-${hex6(c)}" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#${hex6(c)}"/></marker>`;

// ---- main entry ----
/** Render a layout spec. Returns {svg, findings, stats}. Throws SpecError only for malformed JSON or schema errors. */
export function renderSpec(input, {model = null} = {}) {
  let spec = input;
  if (typeof input === 'string') {
    try { spec = JSON.parse(input); } catch (e) { throw new SpecError([{path: '$', message: `invalid JSON: ${e.message}`}]); }
  }
  const errors = validateSpec(spec);
  if (errors.length) throw new SpecError(errors);
  const canvas = {fill: spec.canvas.fill ?? '#ffffff', ink: spec.canvas.ink ?? '#1f2937', ...spec.canvas};
  canvas.fill = canvas.fill.length === 4 ? '#' + hex6(canvas.fill) : canvas.fill; canvas.ink = canvas.ink.length === 4 ? '#' + hex6(canvas.ink) : canvas.ink;
  const roles = {};
  for (const [k, r] of Object.entries(spec.palette)) roles[k] = {fill: '#' + hex6(r.fill), stroke: '#' + hex6(r.stroke), text: '#' + hex6(r.text), meaning: r.meaning};
  const defaultRole = roles.neutral ? 'neutral' : Object.keys(roles)[0];
  const findings = new Map();
  const add = (rule, severity, elements, region, measured, threshold, suggestion) => {
    const id = `${rule}:${[...elements].sort().join('+')}`;
    const f = findings.get(id);
    if (f) { if (f.measured.length < 600) f.measured += `; ${measured}`; return; }
    findings.set(id, {id, source: 'spec-render', severity, rule, elements: [...elements], region, measured, threshold, suggestion});
  };
  const nodes = spec.nodes.map(n => layoutNode(n, roles, defaultRole)), byId = new Map(nodes.map(n => [n.id, n]));
  assignAutoFonts(nodes);
  for (const n of nodes) n.lines = nodeLines(n);
  const groups = (spec.groups ?? []).map(g => {
    const r = g.role ? roles[g.role] : null;
    return {id: g.id, label: g.label, subtitle: g.subtitle, rect: g.rect, fill: r?.fill ?? '#f8fafc', stroke: r?.stroke ?? '#94a3b8', text: r?.text ?? canvas.ink,
      heading: [g.rect[0] + 16, g.rect[1] + 13, measureText(g.label, 18) * 1.05, 22]};
  });
  const groupById = new Map(groups.map(g => [g.id, g]));
  // A group endpoint is measured like a rect node on the group's outline (the container border); isGroup marks it in the SVG and the census.
  const groupEnd = new Map((spec.groups ?? []).map(g => [g.id, {id: g.id, isGroup: true, shape: 'rect', variant: 'rect', x: g.rect[0], y: g.rect[1], w: g.rect[2], h: g.rect[3], polygon: [], outline: null, faceDot: 0, roleName: g.role ?? defaultRole}]));
  const endpoint = id => byId.get(id) ?? groupEnd.get(id);

  // edges
  const edges = (spec.edges ?? []).map((e, i) => {
    const id = e.id ?? `e${i + 1}`, source = endpoint(e.source), target = endpoint(e.target);
    const roleName = e.role ?? target.roleName, role = roles[roleName];
    const route = analyseRoute(e.points, add, id);
    return {id, e, source, target, role, roleName, route, raw: e.points, trunk: e.trunk ?? null};
  });

  // R1/R7/R13: endpoints, ports, final leg
  for (const e of edges) {
    const r = e.route; if (!r) continue;
    const ends = [['start', e.source, r.pts[0], r.pts[1]], ['end', e.target, r.pts[r.pts.length - 1], r.pts[r.pts.length - 2]]];
    for (const [which, node, p, q] of ends) {
      const {gap, at} = nodeOutlineGap(node, p), tol = node.shape === 'cylinder' ? 3.5 : 0.75;
      if (gap > tol) add('endpoint-on-face', 'blocking', [e.id, node.id], regionOf([p, at]), `${which} point (${p[0]}, ${p[1]}) is ${r1(gap)} from the visible outline of ${node.id}${node.shape === 'decision' ? ' (decision tips are pulled in by the 10-unit outline fillet)' : ''}`, `on the outline within ${tol} (rule 7: tip exactly on the edge)`, `move the ${which} point to (${r1(at[0])}, ${r1(at[1])})`);
      else {
        const nrm = node.faceDot ? faceNormal(node, p) : outwardNormal(node, p), ax = orth(p, q), horiz = Math.abs(nrm[0]) > Math.abs(nrm[1]);
        if (ax) {
          // q is the neighbouring point: the start leg runs p->q (must point out of the face), the end leg runs q->p, so p->q must also point out of the face.
          // A group border may be reached from inside the group too (a member's arrow to its own group), so a group endpoint needs only a perpendicular leg.
          const dir = [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])], ok = node.isGroup ? (ax === 'h') === horiz : node.faceDot ? dir[0] * nrm[0] + dir[1] * nrm[1] >= node.faceDot : dir[0] === nrm[0] && dir[1] === nrm[1];
          if (!ok) add('port-direction', 'blocking', [e.id, node.id], regionOf([p, q]), `${which} leg of ${e.id} ${which === 'start' ? 'leaves' : 'arrives at'} ${node.id} along ${ax === 'h' ? 'the horizontal' : 'the vertical'} axis, but the face normal there is ${horiz ? 'horizontal' : 'vertical'}`, 'leave and arrive perpendicular to the face (rule 1)', `${which === 'start' ? 'leave' : 'arrive'} ${horiz ? 'horizontally' : 'vertically'} or move the port to a face that points along the leg`);
        }
      }
    }
    const final = dist(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]), need = (r.bends ? r.lastTrim : 0) + MARKER + SHAFT;
    if (r.legAxis[r.legAxis.length - 1] && final < need - 1e-6) add('final-leg', 'blocking', [e.id], regionOf(r.pts.slice(-2)), `final leg ${r1(final)}`, `>= ${r1(need)} (fillet ${r1(r.bends ? r.lastTrim : 0)} + arrowhead ${MARKER} + shaft ${SHAFT}; rule 13)`, `lengthen the last leg by ${r1(need - final)} or move the target face`);
  }

  // Dense diagram (user decision 2026-10-03): from the threshold up, crossings are measured but minor, and zero is not the goal.
  const dense = denseInfo(model?.edges?.length ?? edges.length);
  // pairwise: crossings and parallel clearance (post-fillet straight spans, as the auditor measures)
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const A = edges[i], B = edges[j]; if (!A.route || !B.route) continue;
    for (const a of A.route.spans) for (const b of B.route.spans) {
      if (a.axis === b.axis) {
        const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo), sep = Math.abs(a.fixed - b.fixed);
        if (overlap > 1e-6 && sep < PARALLEL - 1e-6 && !isAcceptedTrunkOverlap({trunk: A.trunk, target: A.target.id, spans: A.route.spans}, {trunk: B.trunk, target: B.target.id, spans: B.route.spans}, a, b)) add('parallel-clearance', 'blocking', [A.id, B.id], regionOf([[a.axis === 'h' ? Math.max(a.lo, b.lo) : a.fixed, a.axis === 'h' ? a.fixed : Math.max(a.lo, b.lo)], [a.axis === 'h' ? Math.min(a.hi, b.hi) : b.fixed, a.axis === 'h' ? b.fixed : Math.min(a.hi, b.hi)]]), `${a.axis === 'h' ? 'horizontal' : 'vertical'} spans ${r1(sep)} apart over ${r1(overlap)} units${sep < 1e-6 ? ' (coincident; only a final portion shared at one target by connectors with the same trunk id is exempt)' : ''}`, `centreline separation >= ${PARALLEL} (rule 14)`, `move one span by ${r1(PARALLEL - sep)} or more, or route them apart`);
      } else {
        const h = a.axis === 'h' ? a : b, v = a.axis === 'v' ? a : b;
        if (v.fixed > h.lo + 1e-6 && v.fixed < h.hi - 1e-6 && h.fixed > v.lo + 1e-6 && h.fixed < v.hi - 1e-6) add('crossing', dense ? 'minor' : 'blocking', [A.id, B.id], regionOf([[v.fixed - 5, h.fixed - 5], [v.fixed + 5, h.fixed + 5]]), `${A.id} and ${B.id} cross at (${r1(v.fixed)}, ${r1(h.fixed)})${dense ? ` (${dense.reason})` : ''}`, dense ? 'non-blocking in a dense diagram: minimise crossings with port order and lanes, do not chase zero' : 'no crossings (rule 12)', dense ? 'optional: reorder ports or lanes if it costs nothing' : 'reroute one of them around the other, or reorder ports/nodes to remove the crossing');
      }
    }
  }
  // node intrusion, group transit, heading intrusion
  for (const e of edges) {
    if (!e.route) continue;
    for (const s of e.route.spans) {
      for (const n of nodes) {
        if (n === e.source || n === e.target) continue;
        let hit;
        if (n.polygon.length) { hit = false; const len = s.hi - s.lo; for (let t = 0; t <= len && !hit; t += 2) hit = nodeContains(n, s.axis === 'h' ? s.lo + t : s.fixed, s.axis === 'h' ? s.fixed : s.lo + t); }
        else hit = spanHitsBox(s, bbox(n));
        if (hit) add('node-intrusion', 'blocking', [e.id, n.id], regionOf([[...(s.axis === 'h' ? [s.lo, s.fixed] : [s.fixed, s.lo])], [...(s.axis === 'h' ? [s.hi, s.fixed] : [s.fixed, s.hi])]]), `${e.id} runs through node ${n.id}`, 'routes stay outside unrelated nodes (rule 6)', `route around ${n.id} or move it`);
      }
      for (const g of groups) {
        const holds = n => n.x >= g.rect[0] - 0.25 && n.y >= g.rect[1] - 0.25 && n.x + n.w <= g.rect[0] + g.rect[2] + 0.25 && n.y + n.h <= g.rect[1] + g.rect[3] + 0.25;
        if (!(holds(e.source) || holds(e.target)) && spanHitsBox(s, g.rect, 1)) add('group-transit', 'blocking', [e.id, g.id], regionOf([[...(s.axis === 'h' ? [s.lo, s.fixed] : [s.fixed, s.lo])], [...(s.axis === 'h' ? [s.hi, s.fixed] : [s.fixed, s.hi])]]), `${e.id} crosses the interior of group ${g.id}, which holds neither endpoint`, 'routes avoid unrelated containers (rule 6)', `route around group ${g.id}`);
        if (spanHitsBox(s, [g.heading[0] - 2, g.heading[1] - 2, g.heading[2] + 4, g.heading[3] + 4])) add('heading-intrusion', 'blocking', [e.id, g.id], regionOf([[...(s.axis === 'h' ? [s.lo, s.fixed] : [s.fixed, s.lo])], [...(s.axis === 'h' ? [s.hi, s.fixed] : [s.fixed, s.hi])]]), `${e.id} passes through the heading of group ${g.id}`, 'no connector through a heading (T1)', `route the connector below the heading row (y > ${r1(g.heading[1] + g.heading[3] + 2)})`);
      }
    }
  }
  // nodes: overlap, membership, text fit, contrast
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (boxOverlap(bbox(nodes[i]), bbox(nodes[j]))) add('node-overlap', 'blocking', [nodes[i].id, nodes[j].id], regionOf([[nodes[i].x, nodes[i].y], [nodes[j].x + nodes[j].w, nodes[j].y + nodes[j].h]]), `${nodes[i].id} and ${nodes[j].id} overlap`, 'no overlapping nodes (T1/B10)', 'separate the nodes');
  for (const n of nodes) {
    const inside = (g, pad) => n.x >= g.rect[0] + pad && n.y >= g.rect[1] + pad && n.x + n.w <= g.rect[0] + g.rect[2] - pad && n.y + n.h <= g.rect[1] + g.rect[3] - pad;
    if (n.group) { const g = groupById.get(n.group); if (!inside(g, 0)) add('group-membership', 'blocking', [n.id, g.id], regionOf([[n.x, n.y], [n.x + n.w, n.y + n.h]]), `${n.id} is declared in group ${g.id} but is not inside its rectangle`, 'declared members drawn inside their container (B10)', `enlarge group ${g.id} or move ${n.id} inside it`); else if (!inside(g, 4)) add('group-membership', 'minor', [n.id, g.id], regionOf([[n.x, n.y], [n.x + n.w, n.y + n.h]]), `${n.id} is within 4 units of the border of ${g.id}`, 'margin >= 4 (B10)', 'leave margin between the node and the container border'); }
    for (const g of groups) if (g.id !== n.group && inside(g, 0)) add('group-membership', 'blocking', [n.id, g.id], regionOf([[n.x, n.y], [n.x + n.w, n.y + n.h]]), `${n.id} is drawn inside group ${g.id} but is declared ${n.group ? 'in ' + n.group : 'ungrouped'}`, 'drawn containment equals declared membership', `set "group": "${g.id}" on ${n.id} or move it out of ${g.id}`);
    for (const g of groups) if (boxOverlap(bbox(n), [g.heading[0], g.heading[1], g.heading[2], g.heading[3]])) add('heading-intrusion', 'blocking', [n.id, g.id], regionOf([[n.x, n.y], [g.heading[0] + g.heading[2], g.heading[1] + g.heading[3]]]), `${n.id} overlaps the heading of group ${g.id}`, 'no collision with headings (T1)', `move ${n.id} below y=${r1(g.heading[1] + g.heading[3] + 2)}`);
    // text fit (T2): width and height in the labelBox
    const lh = Math.round(n.font * 1.1), need = (n.lines.length - 1) * lh + 1.2 * n.font, widest = Math.max(...n.lines.map(l => W(l, n.font))), [, , lw, lhBox] = n.lb;
    const problems = [];
    if (widest > lw + 1e-6) problems.push(`width ${r1(widest)} > labelBox ${r1(lw)}`);
    if (need > lhBox + 1e-6) problems.push(`height ${r1(need)} (${n.lines.length} lines) > labelBox ${r1(lhBox)}`);
    if (problems.length) {
      const fits = Object.entries(TIERS).find(([, [tw, th]]) => widest <= tw && need <= th);
      add('text-fit', 'blocking', [n.id], regionOf([[n.x, n.y], [n.x + n.w, n.y + n.h]]), `${problems.join('; ')} (estimate)`, 'text inside the labelBox (T2)', fits ? `this text needs tier ${fits[0]} (${fits[1][0]}x${fits[1][1]}) or fewer/shorter lines` : 'shorten or split the text, or use the largest tier (XL 480x160)');
    }
    if (n.explicitLabelBox) {
      const [bx, by, bw, bh] = n.lb, corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]];
      if (!corners.every(([x, y]) => n.polygon.length ? inPoly(x, y, n.polygon) : x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h)) add('label-box', 'blocking', [n.id], regionOf([[n.x, n.y], [n.x + n.w, n.y + n.h]]), `declared labelBox [${n.lb.map(r1).join(', ')}] has a corner outside ${n.id}'s shape`, 'labelBox inside the node outline', 'shrink or move the labelBox, or enlarge the node');
    }
  }
  // labels
  const pills = [];
  for (const e of edges) if (e.e.label) {
    // The pill is w x h flat; a vertical label is the same pill rotated -90 degrees around its centre, so every clearance check below uses the rotated footprint (h x w).
    const t = e.e.label.text, w = 2 * Math.ceil((measureText(t, 15) + 16) / 2), h = 24, vertical = e.e.label.vertical === true, cx = e.e.label.x, cy = e.e.label.y;
    const box = vertical ? [cx - h / 2, cy - w / 2, h, w] : [cx - w / 2, cy - h / 2, w, h];
    const holder = groups.filter(g => e.e.label.x >= g.rect[0] && e.e.label.x <= g.rect[0] + g.rect[2] && e.e.label.y >= g.rect[1] && e.e.label.y <= g.rect[1] + g.rect[3]).pop();
    pills.push({edge: e, text: t, box, w, h, vertical, cx, cy, bg: holder ? holder.fill : canvas.fill});
  }
  for (const p of pills) {
    const {edge, box} = p, region = rectOf(box);
    for (const n of nodes) {
      let hit = false;
      if (n.polygon.length) { for (let x = box[0]; x <= box[0] + box[2] && !hit; x += 1) for (let y = box[1]; y <= box[1] + box[3]; y += 1) if (inPoly(x, y, n.polygon) || (y === box[1] || y === box[1] + box[3] || x === box[0]) && nodeOutlineGap(n, [x, y]).gap < 1.5) { hit = true; break; } }
      else hit = boxOverlap(box, bbox(n), 1.5);
      if (hit) add('label-clearance', 'blocking', [edge.id, n.id], {x: r1(region.x), y: r1(region.y), w: r1(region.w), h: r1(region.h)}, `label "${p.text}" overlaps the outline of node ${n.id}`, 'labels live in open space, clear of outlines (B5)', 'move the label into open space beside its route');
    }
    for (const g of groups) {
      const outer = boxOverlap(box, g.rect, 1), inner = box[0] >= g.rect[0] + 1 && box[1] >= g.rect[1] + 1 && box[0] + box[2] <= g.rect[0] + g.rect[2] - 1 && box[1] + box[3] <= g.rect[1] + g.rect[3] - 1;
      if (outer && !inner && !(box[0] + box[2] < g.rect[0] || box[0] > g.rect[0] + g.rect[2] || box[1] + box[3] < g.rect[1] || box[1] > g.rect[1] + g.rect[3]) && !(box[0] >= g.rect[0] + g.rect[2] + 1 || box[1] >= g.rect[1] + g.rect[3] + 1 || box[0] + box[2] <= g.rect[0] - 1 || box[1] + box[3] <= g.rect[1] - 1)) {
        add('label-clearance', 'blocking', [edge.id, g.id], region, `label "${p.text}" straddles the border of group ${g.id}`, 'labels clear of container outlines (B5)', 'place the label wholly inside or wholly outside the container');
      }
    }
    for (const other of edges) {
      if (!other.route || other === edge) continue;
      if (other.route.spans.some(s => boxOverlap(box, spanBox(s), 0.5))) add('label-on-route', 'blocking', [edge.id, other.id], region, `label "${p.text}" of ${edge.id} sits on the route of ${other.id}`, 'a label never covers another connector (rule 11/T1)', 'move the label beside its own route');
    }
    // User rule 2026-10-05 ("标签覆盖箭头的时候应该判定失败"): no label covers any arrowhead, its own route's included. The spec marker is a 10x10
    // userSpaceOnUse triangle with its tip on the route end, so its footprint is 10 back along the final leg and 10 wide, centred on the leg.
    for (const other of edges) {
      const pts = other.route?.pts;
      if (!pts || pts.length < 2) continue;
      const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2], l = Math.hypot(ex - px, ey - py);
      if (!(l > 0)) continue;
      const dx = (ex - px) / l, dy = (ey - py) / l, xs = [], ys = [];
      for (const along of [-ARROW_LEN, 0]) for (const across of [-ARROW_W / 2, ARROW_W / 2]) { xs.push(ex + along * dx - across * dy); ys.push(ey + along * dy + across * dx); }
      const head = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      if (boxOverlap(box, head, 0.5)) add('label-on-arrowhead', 'blocking', other === edge ? [edge.id] : [edge.id, other.id], region, `label "${p.text}" of ${edge.id} covers the arrowhead of ${other.id}`, 'a label never covers an arrowhead, its own route\'s included (user rule: 标签覆盖箭头的时候应该判定失败)', 'move the label along its own route away from the arrowhead');
    }
    for (const q of pills) if (q !== p && boxOverlap(box, q.box)) add('label-overlap', 'blocking', [edge.id, q.edge.id], region, `labels "${p.text}" and "${q.text}" overlap`, 'no text collisions (T1)', 'separate the labels');
    if (edge.route) {
      const own = polyDist(edge.route.pts, box);
      let nearest = null;
      for (const other of edges) if (other !== edge && other.route) { const d = polyDist(other.route.pts, box); if (!nearest || d < nearest.d) nearest = {d, id: other.id}; }
      if (own > 20) add('label-detached', 'minor', [edge.id], region, `label "${p.text}" is ${r1(own)} from its own route`, '<= 20 (attached)', 'move the label next to its route');
      else if (nearest && nearest.d + 4 < own) add('label-detached', 'minor', [edge.id, nearest.id], region, `label "${p.text}" of ${edge.id} is ${r1(own)} from its route but ${r1(nearest.d)} from ${nearest.id}`, 'nearest route is the labelled one', `move the label closer to ${edge.id}`);
    }
  }
  // contrast (C): every normal-text pair >= 4.5
  const lowContrast = (el, fg, bg, what) => { const c = contrast(fg, bg); if (c < 4.5) add('contrast', 'blocking', el, null, `${what} contrast ${c.toFixed(2)}:1 (${fg} on ${bg})`, '>= 4.5:1', 'darken the text or lighten the fill, keeping the hue'); };
  for (const k of new Set(nodes.map(n => n.roleName))) lowContrast([k], roles[k].text, roles[k].fill, `role ${k} node text`);
  for (const p of pills) lowContrast([p.edge.id], p.edge.role.text, p.bg, `label "${p.text}" text`);
  for (const g of groups) lowContrast([g.id], g.text, g.fill, `group ${g.id} heading`);
  lowContrast(['legend'], canvas.ink, canvas.fill, 'canvas ink');
  // canvas bounds
  const outside = (el, box, what) => { if (box[0] < -0.01 || box[1] < -0.01 || box[0] + box[2] > spec.canvas.w + 0.01 || box[1] + box[3] > spec.canvas.h + 0.01) add('out-of-canvas', 'minor', el, rectOf(box), `${what} extends outside the ${spec.canvas.w}x${spec.canvas.h} canvas`, 'inside the canvas', 'enlarge the canvas or move it'); };
  for (const n of nodes) outside([n.id], bbox(n), `node ${n.id}`);
  for (const g of groups) outside([g.id], g.rect, `group ${g.id}`);
  for (const p of pills) outside([p.edge.id], p.box, `label of ${p.edge.id}`);
  for (const e of edges) if (e.route) { const r = regionOf(e.route.pts); outside([e.id], [r.x, r.y, r.w, r.h], `route ${e.id}`); }
  // census against the parsed source
  if (model) census(model, nodes, edges, add);

  // ---- SVG ----
  const parts = [];
  for (const g of groups) {
    const sub = g.subtitle ? `<text x="${n3(g.rect[0] + 16)}" y="${n3(g.rect[1] + 46)}" font-size="15" font-weight="400" dominant-baseline="central" fill="${g.text}">${esc(g.subtitle)}</text>` : '';
    parts.push(`<g data-group="${esc(g.id)}" data-container-id="${esc(g.id)}"><rect x="${n3(g.rect[0])}" y="${n3(g.rect[1])}" width="${n3(g.rect[2])}" height="${n3(g.rect[3])}" rx="${NODE_R}" fill="${g.fill}" stroke="${g.stroke}" stroke-width="1"/><text x="${n3(g.rect[0] + 16)}" y="${n3(g.rect[1] + 24)}" font-size="18" font-weight="600" dominant-baseline="central" fill="${g.text}">${esc(g.label)}</text>${sub}</g>`);
  }
  const colours = new Set();
  for (const e of edges) if (e.route) {
    colours.add(e.role.stroke);
    parts.push(`<path id="${esc(e.id)}" data-edge="${esc(e.id)}" data-source="${esc(e.source.id)}" data-target="${esc(e.target.id)}"${e.source.isGroup ? ' data-source-kind="group"' : ''}${e.target.isGroup ? ' data-target-kind="group"' : ''}${e.trunk ? ` data-shared-trunk="${esc(e.trunk)}"` : ''} d="${e.route.d}" fill="none" stroke="${e.role.stroke}" stroke-width="1"${e.e.dashed ? ` stroke-dasharray="${DASH}"` : ''} marker-end="url(#arrow-${hex6(e.role.stroke)})"/>`);
  }
  for (const n of nodes) parts.push(nodeSvg(n));
  for (const p of pills) parts.push(`<g data-edge-label-source="${esc(p.edge.source.id)}" data-edge-label-target="${esc(p.edge.target.id)}"${p.vertical ? ` transform="rotate(-90 ${n3(p.cx)} ${n3(p.cy)})"` : ''}><rect x="${n3(p.cx - p.w / 2)}" y="${n3(p.cy - p.h / 2)}" width="${p.w}" height="${p.h}" rx="${p.h / 2}" fill="${p.bg}" stroke="none"/><text x="${n3(p.cx)}" y="${n3(p.cy)}" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="400" fill="${p.edge.role.text}">${esc(p.text)}</text></g>`);
  if (spec.legend) legend(spec.legend, roles, canvas, parts, colours);
  const palette = Object.entries(roles).map(([k, r]) => `${k}: background ${r.fill} + text ${r.text}, border ${r.stroke} = ${r.meaning}`).join(' | ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n3(spec.canvas.w)}" height="${n3(spec.canvas.h)}" viewBox="0 0 ${n3(spec.canvas.w)} ${n3(spec.canvas.h)}" role="img">`
    + `<title>${esc(spec.canvas.title ?? 'Diagram')}</title><desc>${esc(spec.canvas.desc ?? '')}</desc><!-- ${comment('semantic-palette | ' + palette)} -->`
    + `<defs><style>text{font-family:${FONT}}</style>${[...colours].sort().map(markerDef).join('')}</defs>`
    + `<rect width="${n3(spec.canvas.w)}" height="${n3(spec.canvas.h)}" fill="${canvas.fill}"/>\n${parts.join('\n')}</svg>\n`;
  const list = [...findings.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1) || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id));
  return {svg, findings: list, stats: {nodes: nodes.length, edges: edges.length, groups: groups.length, labels: pills.length, bytes: Buffer.byteLength(svg)}};
}

function legend(lg, roles, canvas, parts, colours) {
  let x = lg.x, y = lg.y;
  const gap = lg.gap ?? (lg.direction === 'right' ? 32 : 28);
  for (const en of lg.entries) {
    const r = roles[en.role], ex = en.x ?? x, ey = en.y ?? y;
    let width;
    if (en.kind === 'node') {
      const shape = canonShape(en.shape ?? 'rect'), paint = `fill="${r.fill}" stroke="${r.stroke}" stroke-width="2"`, line = d => `<path d="${d}" fill="none" stroke="${r.stroke}" stroke-width="2"/>`, cy = ey + 9;
      const poly = pts => `<polygon points="${pts.map(q => `${n3(q[0])},${n3(q[1])}`).join(' ')}" ${paint} stroke-linejoin="round"/>`;
      let mark;
      if (shape === 'decision') mark = `<path d="${roundedPolygon([[ex + 12, ey], [ex + 24, ey + 9], [ex + 12, ey + 18], [ex, ey + 9]], 4)}" ${paint}/>`;
      else if (shape === 'cylinder') mark = `<path d="M ${n3(ex)} ${n3(ey + 4)} C ${n3(ex)} ${n3(ey - 1)} ${n3(ex + 24)} ${n3(ey - 1)} ${n3(ex + 24)} ${n3(ey + 4)} L ${n3(ex + 24)} ${n3(ey + 14)} C ${n3(ex + 24)} ${n3(ey + 19)} ${n3(ex)} ${n3(ey + 19)} ${n3(ex)} ${n3(ey + 14)} Z" ${paint}/>${line(`M ${n3(ex)} ${n3(ey + 4)} C ${n3(ex)} ${n3(ey + 9)} ${n3(ex + 24)} ${n3(ey + 9)} ${n3(ex + 24)} ${n3(ey + 4)}`)}`;
      else if (shape === 'subroutine') mark = `<rect x="${n3(ex)}" y="${n3(ey)}" width="24" height="18" rx="${NODE_R}" ${paint}/>${line(`M ${n3(ex + 5)} ${n3(ey)} L ${n3(ex + 5)} ${n3(ey + 18)} M ${n3(ex + 19)} ${n3(ey)} L ${n3(ex + 19)} ${n3(ey + 18)}`)}`;
      else if (shape === 'circle') mark = `<circle cx="${n3(ex + 12)}" cy="${n3(cy)}" r="9" ${paint}/>`;
      else if (shape === 'doublecircle') mark = `<circle cx="${n3(ex + 12)}" cy="${n3(cy)}" r="9" ${paint}/><circle cx="${n3(ex + 12)}" cy="${n3(cy)}" r="5" fill="none" stroke="${r.stroke}" stroke-width="2"/>`;
      else if (SLANTED.includes(shape)) mark = poly(slantedPolygon(shape, ex, ey, 24, 18));
      else mark = `<rect x="${n3(ex)}" y="${n3(ey)}" width="24" height="18" rx="${shape === 'capsule' ? 9 : NODE_R}" ${paint}/>`;
      parts.push(`<g data-legend="${esc(en.label)}">${mark}<text x="${n3(ex + 34)}" y="${n3(ey + 9)}" font-size="16" font-weight="400" dominant-baseline="central" fill="${canvas.ink}">${esc(en.label)}</text></g>`);
      width = 34 + measureText(en.label, 16);
    } else {
      const len = en.length ?? 48; colours.add(r.stroke);
      parts.push(`<g data-legend="${esc(en.label)}"><path d="M ${n3(ex)},${n3(ey + 9)} L ${n3(ex + len)},${n3(ey + 9)}" fill="none" stroke="${r.stroke}" stroke-width="1"${en.dashed ? ` stroke-dasharray="${DASH}"` : ''} marker-end="url(#arrow-${hex6(r.stroke)})"/><text x="${n3(ex + len + 12)}" y="${n3(ey + 9)}" font-size="16" font-weight="400" dominant-baseline="central" fill="${canvas.ink}">${esc(en.label)}</text></g>`);
      width = len + 12 + measureText(en.label, 16);
    }
    if (en.x === undefined && en.y === undefined) { if (lg.direction === 'right') x += width + gap; else y += gap; }
  }
}

const SOURCE_NOTATION = {rect: 'rect', capsule: 'capsule', diamond: 'decision', cylinder: 'cylinder', subroutine: 'subroutine'};
function census(model, nodes, edges, add) {
  const want = new Map(model.nodes.map(n => [n.id, n])), have = new Map(nodes.map(n => [n.id, n]));
  for (const id of want.keys()) if (!have.has(id)) add('census', 'blocking', [id], null, `missing node ${id}`, 'every source node drawn', `add node ${id}`);
  for (const id of have.keys()) if (!want.has(id)) add('census', 'blocking', [id], null, `extra node ${id}`, 'no invented nodes', `remove node ${id}`);
  for (const [id, w] of want) { const h = have.get(id); if (h && norm(Array.isArray(h.text) ? h.text.join(' ') : h.text) !== norm(w.text)) add('census', 'blocking', [id], null, `text of node ${id} is ${JSON.stringify(norm(Array.isArray(h.text) ? h.text.join(' ') : h.text))}, source says ${JSON.stringify(norm(w.text))}`, 'exact source text', `use the source text for ${id}`); }
  // shape-change (rules, Shapes): a source shape that has a rule notation keeps it. Source shapes without one (stadium, circle, hexagon, parallelograms, ...) are never checked.
  for (const [id, w] of want) {
    const h = have.get(id), expect = SOURCE_NOTATION[w.shape];
    if (h && expect && h.shape !== expect) add('shape-change', 'blocking', [id], null, `node ${id} is drawn as ${h.shape}, source shape ${w.shape} is the ${expect} notation`, `${expect} (the reviewer reports any other shape as shape-change)`, `set "shape": "${expect}" on ${id}`);
  }
  // Node edges and node-to-group edges (model.groupEdges) are one pool: the key marks each group end, so a group arrow redrawn to a member node is extra + missing.
  const end = (id, isGroup) => `${id}${isGroup ? ' (group)' : ''}`;
  const key = e => `${end(e.source, e.sourceIsGroup)}->${end(e.target, e.targetIsGroup)}`, pool = new Map();
  for (const e of [...model.edges, ...(model.groupEdges ?? [])]) (pool.get(key(e)) ?? pool.set(key(e), []).get(key(e))).push(e);
  for (const e of edges) {
    const k = `${end(e.source.id, e.source.isGroup)}->${end(e.target.id, e.target.isGroup)}`, list = pool.get(k) ?? [], i = list.findIndex(w => (w.style === 'dashed') === !!e.e.dashed && norm(w.label) === norm(e.e.label?.text));
    const at = i >= 0 ? i : 0, w = list[at];
    if (!w) { add('census', 'blocking', [e.id], null, `extra relation ${k}`, 'no invented relations', `remove ${e.id}`); continue; }
    list.splice(at, 1);
    if ((w.style === 'dashed') !== !!e.e.dashed) add('census', 'blocking', [e.id], null, `${k} is ${e.e.dashed ? 'dashed' : 'solid'}, source says ${w.style}`, 'dashed flag as in source', `set dashed=${w.style === 'dashed'}`);
    if (norm(w.label) !== norm(e.e.label?.text)) add('census', 'blocking', [e.id], null, `label of ${k} is ${JSON.stringify(norm(e.e.label?.text))}, source says ${JSON.stringify(norm(w.label))}`, 'exact source edge label', 'use the source label');
  }
  for (const [k, list] of pool) for (const w of list) add('census', 'blocking', [k], null, `missing relation ${k}`, 'every source relation drawn', `add an edge ${k}`);
}

/** Text report for a render: header line plus one line per finding. */
export function formatRenderReport(result, {svgHash = null, max = 30, path = 'candidate.svg'} = {}) {
  const f = result.findings, blocking = f.filter(x => x.severity === 'blocking').length;
  const s = result.stats;
  const lines = [`Rendered ${path}${svgHash ? ` (sha256 ${svgHash.slice(0, 12)})` : ''}: ${s.nodes} nodes, ${s.edges} edges, ${s.groups} groups, ${s.labels} labels; ${f.length} findings (${blocking} blocking, ${f.length - blocking} minor).`,
    'Nothing was moved or repaired: the SVG is exactly your layout.json. Findings are measurements against the Diagram Rules; you decide the fix.'];
  for (const x of f.slice(0, max)) lines.push(`- [${x.severity}] ${x.rule} ${x.elements.join(',')}${x.region ? ` @(${x.region.x},${x.region.y},${x.region.w}x${x.region.h})` : ''}: ${x.measured}; need ${x.threshold}. Direction: ${x.suggestion}`);
  if (f.length > max) lines.push(`- ... ${f.length - max} more findings omitted; fix the above and render again.`);
  return lines.join('\n');
}
