import { createHash } from 'node:crypto';

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
/** Every refusal names the construct and the 1-based source line: nothing is dropped silently. */
const fail = (line, construct, detail) => { throw Error(`PARSE_UNSUPPORTED line ${line}: ${construct}${detail ? ` (${detail})` : ''}`); };
const snippet = s => JSON.stringify(s.trim().slice(0, 24));

const dirOf = d => (Object.hasOwn(DIRECTIONS, d) ? DIRECTIONS[d] : undefined);
const DIRECTIONS = { TB: 'TB', TD: 'TB', BT: 'BT', RL: 'RL', LR: 'LR', '<': 'RL', '>': 'LR', '^': 'BT', v: 'TB' };
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const NEUTRAL = { fill: '#f1f5f9', stroke: '#334155', text: '#0f172a', meaning: 'Unclassified diagram element' };

/** Text is data: <br> becomes a newline, entities decode, any other tag is refused (never executed, never stripped). */
const FORMAT_TAG = /<\/?(b|i|u|s|em|strong|code|span|small|sub|sup|mark|kbd)(?:\s[^<>]*)?>/gi;
function decodeText(raw, line, what, markup = null) {
  let t = raw.replace(/<br\s*\/?\s*>/gi, '\n').replace(FORMAT_TAG, (m, tag) => { markup?.add(tag.toLowerCase()); return ''; });
  if (/<\/?[A-Za-z!][^<>]*>/.test(t)) fail(line, `HTML in ${what}`);
  t = t.replace(/&(amp|lt|gt|quot|apos|nbsp);|#(amp|lt|gt|quot|apos|nbsp);|&#(\d+);|&#x([0-9a-f]+);|#(\d+);/gi,
    (m, a, b, c, d, e) => (a || b) ? ENTITIES[(a || b).toLowerCase()] : String.fromCodePoint(Number(c ?? e ?? parseInt(d, 16))));
  return t;
}
/** Mermaid renders a "`...`" string as Markdown; the parser has no faithful text for it, so it refuses rather than keep the backticks. */
const noMarkdown = (t, line) => { if (/^\s*`[\s\S]*`\s*$/.test(t)) fail(line, 'markdown string'); return t; };
const unquote = s => { const t = s.trim(); return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t; };

/** Shapes by opener. `closers` maps each accepted closer to the shape it yields. */
/** Parsed shapes that the rules and the spec renderer have no notation for: no check may PASS a shape claim about them. */
export const NOT_CHECKABLE_SHAPES = new Set(['stadium', 'circle', 'doublecircle', 'hexagon', 'parallelogram', 'parallelogram_alt', 'trapezoid', 'trapezoid_alt', 'asymmetric']);

const SHAPES = [
  ['(((', { ')))': 'doublecircle' }], ['((', { '))': 'circle' }], ['([', { '])': 'stadium' }], ['[[', { ']]': 'subroutine' }],
  ['[(', { ')]': 'cylinder' }], ['{{', { '}}': 'hexagon' }],
  ['[/', { '/]': 'parallelogram', '\\]': 'trapezoid' }], ['[\\', { '\\]': 'parallelogram_alt', '/]': 'trapezoid_alt' }],
  ['{', { '}': 'diamond' }], ['(', { ')': 'capsule' }], ['[', { ']': 'rect' }], ['>', { ']': 'asymmetric' }],
];

/** An edge label that has begun (`-- text`, `== text`, `-. text`) but not reached its arrow continues over the line break, as in Mermaid's lexer. */
const INLINE_OPEN = /(?<![-=.])(?:<?--|<?==)[ \t]+(?:(?!-{2,}[>ox-]|={2,}[>ox=]).)*$|(?<![-=.])<?-\.(?![-.])[ \t]*(?:(?!\.+-).)*$/s;

function inlineOpen(cur) {
  let t = cur.replace(/"[^"]*"/g, '""');
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(/\([^()]*\)|\{[^{}]*\}|\[[^\[\]]*\]/g, '()'); }
  return INLINE_OPEN.test(t);
}

/** An open edge label may continue over at most this many line breaks; each continuation rescans the statement, so the cap keeps splitting linear. */
const MAX_LABEL_LINES = 64;

/** Splits the source into statements: newline or `;` ends one unless it sits inside quotes, square brackets (multi-line node text),
 *  an `|edge label|`, or an entity such as `&amp;`. Full-line `%%` comments (including `%%{init}%%`) are dropped. */
function splitStatements(text) {
  const out = []; let cur = '', curLine = 1, line = 1, inQuote = false, depth = 0, started = false, continued = 0;
  const flush = () => { if (cur.trim()) out.push({ text: cur.trim(), line: curLine }); cur = ''; started = false; continued = 0; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      if (inQuote || depth > 0) { cur += c; line++; continue; }
      if (started && inlineOpen(cur)) { if (++continued > MAX_LABEL_LINES) fail(curLine, 'edge label', `open over more than ${MAX_LABEL_LINES} lines`); cur += c; line++; continue; }
      flush(); line++; continue;
    }
    if (!started && !inQuote && depth === 0) {
      if (/\s/.test(c)) continue;
      if (c === '%' && text[i + 1] === '%') { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
      started = true; curLine = line;
    }
    if (c === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (c === '[') depth++; else if (c === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && c === ';' && !/(?:&(?:amp|lt|gt|quot|apos|nbsp)|&#\d+|#(?:amp|lt|gt|quot|apos|nbsp)|#\d+)$/i.test(cur)) { flush(); continue; }
      else if (depth === 0 && c === '|' && /(?:[>\-.=~]|[-=.][ox])\s*$/.test(cur)) {
        let j = i + 1; while (text[j] === ' ') j++;
        if (text[j] === '"') { const q = text.indexOf('"', j + 1); j = q < 0 ? text.length : text.indexOf('|', q); } else j = text.indexOf('|', i + 1);
        if (j < 0 || text.slice(i, j).includes('\n')) { cur += c; continue; }
        cur += text.slice(i, j + 1); i = j; continue;
      }
    }
    cur += c;
  }
  if (inQuote || depth > 0) fail(curLine, 'unterminated node text or quote');
  flush();
  return out;
}

/** Front matter: `---` ... `---` before the diagram. `title` is kept as data; every other key (config, theme, layout) is ignored. Line numbers stay intact. */
function stripFrontMatter(lines) {
  const first = lines.findIndex(l => l.trim());
  if (first < 0 || lines[first].trim() !== '---') return { title: null, lines };
  const end = lines.findIndex((l, i) => i > first && l.trim() === '---');
  if (end < 0) fail(first + 1, 'front matter', 'unterminated');
  let title = null;
  for (let i = first + 1; i < end; i++) { const m = lines[i].match(/^title:\s*(.*?)\s*$/); if (m) title = decodeText(unquote(m[1]).replace(/^'(.*)'$/, '$1'), i + 1, 'front matter title'); }
  return { title, lines: lines.map((l, i) => (i >= first && i <= end ? '' : l)) };
}

/** subgraph header -> {id|null, title}. Mermaid gives an id-less subgraph (`subgraph "Title"`, `subgraph Several words`) a generated id. */
function subgraphHeader(rest, line) {
  const r = rest.trim();
  if (!r) return { id: null, title: '' };
  let m = r.match(/^([^\s\[\]"]+)\s*\[\s*(?:"([^"]*)"|(.*?))\s*\]$/);
  if (m) return { id: m[1], title: decodeText(m[2] !== undefined ? noMarkdown(m[2], line) : m[3], line, 'subgraph title') };
  m = r.match(/^"([^"]*)"$/);
  if (m) return { id: null, title: decodeText(noMarkdown(m[1], line), line, 'subgraph title') };
  if (/^[^\s\[\]"]+$/.test(r)) return { id: r, title: r };
  if (!/[\[\]"]/.test(r)) return { id: null, title: decodeText(r, line, 'subgraph title') };
  return fail(line, 'subgraph header', snippet(r));
}

const ID_RE = /(?:[\p{L}\p{N}_]|-(?=[\p{L}\p{N}_]))+/uy;
const OP_PLAIN = /(<)?(-{2,}|={2,})([>ox])?/y;
const OP_DOTTED = /(<)?-?\.+-([>ox])?/y;
const OP_INVISIBLE = /~{3,}/y;
const HEAD = { '>': 'normal', o: 'circle', x: 'cross' };

export function parseMermaid(source) {
  if (typeof source !== 'string' || source.length > 2_000_000) fail(1, 'input size');
  const { title, lines } = stripFrontMatter(source.replace(/\r\n/g, '\n').split('\n'));
  const statements = splitStatements(lines.join('\n'));
  if (!statements.length) fail(1, 'empty diagram');

  const head = statements[0], hm = head.text.match(/^(flowchart-elk|flowchart|graph)(?:\s+(\S+))?$/);
  if (!hm) fail(head.line, /^(?:flowchart|graph)\b/.test(head.text) ? 'diagram header' : 'diagram type', snippet(head.text.split(/\s/)[0]));
  if (hm[1] === 'flowchart-elk') fail(head.line, 'flowchart-elk renderer');
  const direction = hm[2] === undefined ? 'TB' : dirOf(hm[2]);
  if (!direction) fail(head.line, 'direction', snippet(hm[2]));
  const body = statements.slice(1);

  // Pre-pass: explicit subgraph ids, so edges may name a subgraph before or after its block.
  const groupIds = new Set();
  for (const st of body) { const m = st.text.match(/^subgraph(?:\s+(.*))?$/s); if (m) { const h = subgraphHeader(m[1] ?? '', st.line); if (h.id) { if (groupIds.has(h.id)) fail(st.line, 'duplicate subgraph id', h.id); groupIds.add(h.id); } } }

  const nodes = new Map(), edges = [], groupEdges = [], layoutLinks = [], groupList = [], completed = [], stack = [], palette = Object.create(null), notCheckable = [], ignored = [], definitions = new Map();
  let subCount = 0;

  function touch(id, spec, line) {
    const top = stack.at(-1) ?? null;
    let n = nodes.get(id);
    if (!n) { n = { id, text: id, shape: 'rect', declGroup: top, role: 'neutral', classes: [], order: line, defined: false, markup: [] }; nodes.set(id, n); }
    if (top) top.refs.add(id);
    if (spec.text !== undefined) {
      // Mermaid's addVertex keeps the LAST text and shape; a differing redefinition is kept as a recorded conflict, not refused.
      (definitions.get(id) ?? definitions.set(id, []).get(id)).push({ line, text: spec.text, shape: spec.shape });
      n.text = spec.text; n.shape = spec.shape; n.declGroup = top; n.defined = true;
    }
    for (const t of spec.markup) if (!n.markup.includes(t)) n.markup.push(t);
    for (const c of spec.classes) n.classes.push(c);
    return n;
  }

  function parseStatement(s, line) {
    let p = 0;
    const ws = () => { while (p < s.length && /\s/.test(s[p])) p++; };
    const rest = () => s.slice(p);

    function readNode() {
      ws();
      if (p >= s.length) fail(line, 'edge', 'missing endpoint');
      ID_RE.lastIndex = p; const m = ID_RE.exec(s);
      if (!m) fail(line, 'syntax', `near ${snippet(rest())}`);
      const id = m[0]; p += id.length;
      if (s[p] === '@') fail(line, s[p + 1] === '{' ? '@{ node attribute syntax' : 'edge id');
      const spec = { id, classes: [], markup: [] };
      let q = p; while (q < s.length && /[ \t]/.test(s[q])) q++;
      if (s.startsWith('@{', q)) fail(line, '@{ node attribute syntax');
      if (s.startsWith('(-', q)) fail(line, 'ellipse node shape (-…-)');
      if (s.startsWith('[|', q)) fail(line, 'node properties [|…|]');
      const opener = SHAPES.find(([o]) => s.startsWith(o, q) && (o !== '>' || q === p));
      if (opener) {
        const [o, closers] = opener; let t = q + o.length, text, closeAt = -1, closer;
        while (s[t] === ' ') t++;
        if (s[t] === '"') {
          const e = s.indexOf('"', t + 1); if (e < 0) fail(line, 'unterminated node text or quote');
          text = noMarkdown(s.slice(t + 1, e), line); t = e + 1; while (s[t] === ' ') t++;
          closer = Object.keys(closers).find(c => s.startsWith(c, t)); closeAt = closer ? t : -1;
        } else {
          for (let k = t; k < s.length && closeAt < 0; k++) { closer = Object.keys(closers).find(c => s.startsWith(c, k)); if (closer) closeAt = k; }
          if (closeAt >= 0) text = s.slice(t, closeAt);
        }
        if (closeAt < 0) fail(line, 'node text', `unclosed ${o}`);
        const markup = new Set(); spec.shape = closers[closer]; spec.text = decodeText(text.trim(), line, 'node text', markup); spec.markup = [...markup]; p = closeAt + closer.length;
      }
      for (let m2; (m2 = /^:::((?:\w|-(?=\w))+)/.exec(s.slice(p)));) { spec.classes.push(m2[1]); p += m2[0].length; }
      if (groupIds.has(id)) { if (spec.text !== undefined) fail(line, 'subgraph id used as a node', id); const top = stack.at(-1); if (top && top.id !== id) top.refs.add(id); return { id, isGroup: true }; }
      touch(id, spec, line);
      return { id, isGroup: false };
    }
    function readNodeGroup() { const refs = [readNode()]; ws(); while (s[p] === '&') { p++; refs.push(readNode()); ws(); } return refs; }

    function readLabel() {
      ws(); if (s[p] !== '|') return null;
      let t = p + 1; while (s[t] === ' ') t++;
      let text, end;
      if (s[t] === '"') { const q = s.indexOf('"', t + 1); end = q < 0 ? -1 : s.indexOf('|', q); text = q < 0 ? '' : noMarkdown(s.slice(t + 1, q), line); }
      else { end = s.indexOf('|', t); text = end < 0 ? '' : s.slice(t, end); }
      if (end < 0) fail(line, 'edge label', 'unterminated |label|');
      p = end + 1; return decodeText(text.trim(), line, 'edge label');
    }
    function inlineText(startRe, endRe, accept) {
      const sm = startRe.exec(rest()); if (!sm) return null;
      const from = p + sm[0].length; let text = null, scanFrom = from;
      if (s[from] === '"') { const q = s.indexOf('"', from + 1); if (q < 0) fail(line, 'edge label', 'unterminated quote'); text = noMarkdown(s.slice(from + 1, q), line); scanFrom = q + 1; }
      const g = new RegExp(endRe.source, 'g'); g.lastIndex = scanFrom; let m;
      while ((m = g.exec(s)) && !accept(m)) { if (!m[0]) g.lastIndex++; }
      if (!m || (text !== null && m.index !== scanFrom)) return null;
      return { text: (text ?? s.slice(from, m.index)).replace(/\s*\n\s*/g, ' ').trim(), m, end: m.index + m[0].length, tail: sm[1] };
    }
    function readOp() {
      ws(); if (p >= s.length) return null;
      let m;
      OP_INVISIBLE.lastIndex = p;
      if ((m = OP_INVISIBLE.exec(s))) { p += m[0].length; return { style: 'invisible', thick: false, arrow: 'none', bidirectional: false, label: '' }; }
      OP_PLAIN.lastIndex = p;
      if ((m = OP_PLAIN.exec(s)) && (m[3] || m[2].length >= 3)) {
        if (m[1] && m[3] !== '>') fail(line, 'edge tail', '<');
        p += m[0].length; return { style: 'solid', thick: m[2][0] === '=', arrow: m[3] ? HEAD[m[3]] : 'none', bidirectional: !!m[1], label: '' };
      }
      OP_DOTTED.lastIndex = p;
      if ((m = OP_DOTTED.exec(s))) {
        if (m[1] && m[2] !== '>') fail(line, 'edge tail', '<');
        p += m[0].length; return { style: 'dashed', thick: false, arrow: m[2] ? HEAD[m[2]] : 'none', bidirectional: !!m[1], label: '' };
      }
      const longOrHeaded = m2 => !!m2[2] || m2[1].length >= 3;
      for (const [startRe, endRe, accept, style, thick] of [
        [/^(<)?--\s*/, /\s*(-{2,})([>ox])?/, longOrHeaded, 'solid', false],
        [/^(<)?==\s*/, /\s*(={2,})([>ox])?/, longOrHeaded, 'solid', true],
        [/^(<)?-\.(?![-.])\s*/, /\s*\.+-([>ox])?/, () => true, 'dashed', false]]) {
        const r = inlineText(startRe, endRe, accept); if (!r) continue;
        const head = style === 'dashed' ? r.m[1] : r.m[2];
        if (r.tail && head !== '>') fail(line, 'edge tail', '<');
        p = r.end; return { style, thick, arrow: head ? HEAD[head] : 'none', bidirectional: !!r.tail, label: decodeText(r.text, line, 'edge label') };
      }
      if (/^[^\s]+@[-=.~<]/.test(rest())) fail(line, 'edge id');
      return fail(line, 'syntax', `near ${snippet(rest())}`);
    }

    let left = readNodeGroup(); ws();
    // A bare reference line inside a subgraph (`n1`, `a & b`) is an explicit membership declaration for a node that was only used at the top level so far.
    if (p >= s.length && stack.length) for (const r of left) { const n = r.isGroup ? null : nodes.get(r.id); if (n && n.declGroup === null) { n.declGroup = stack.at(-1); } }
    while (p < s.length) {
      const op = readOp(), piped = readLabel();
      if (piped !== null) { if (op.label) fail(line, 'edge label', 'given twice'); op.label = piped; }
      const right = readNodeGroup();
      for (const a of left) for (const b of right) addEdge(a, b, op, line);
      left = right; ws();
    }
  }

  function addEdge(a, b, op, line) {
    if (op.style === 'invisible') { layoutLinks.push({ source: a.id, target: b.id, sourceIsGroup: a.isGroup, targetIsGroup: b.isGroup, line }); return; }
    const base = { label: op.label, style: op.style, thick: op.thick, arrow: op.arrow, bidirectional: op.bidirectional };
    if (op.arrow !== 'normal') notCheckable.push({ construct: `edge arrowhead ${op.arrow}`, line });
    if (op.bidirectional) notCheckable.push({ construct: 'bidirectional edge', line });
    if (a.isGroup || b.isGroup) {
      groupEdges.push({ id: `g${groupEdges.length + 1}`, source: a.id, target: b.id, sourceIsGroup: a.isGroup, targetIsGroup: b.isGroup, ...base });
      notCheckable.push({ construct: 'group-endpoint edge', line });
    } else edges.push({ id: `e${edges.length + 1}`, source: a.id, target: b.id, ...base });
  }

  function addClassDef(names, values, line) {
    const parts = []; let depth = 0, cur = '';
    for (const c of values.replace(/;\s*$/, '')) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c; }
    parts.push(cur);
    const v = Object.create(null);
    for (const part of parts) { const k = part.indexOf(':'); if (k < 1) fail(line, 'classDef token', snippet(part)); v[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
    for (const name of names.split(',')) palette[name.trim()] = { fill: v.fill ?? NEUTRAL.fill, stroke: v.stroke ?? NEUTRAL.stroke, text: v.color ?? '#17212b', meaning: name.trim() };
  }

  for (const { text: s, line } of body) {
    let m;
    if ((m = s.match(/^subgraph(?:\s+(.*))?$/s))) {
      const h = subgraphHeader(m[1] ?? '', line);
      const g = { id: h.id, title: h.title, parentObj: stack.at(-1) ?? null, direction: null, order: line, line, refs: new Set() };
      groupList.push(g); stack.push(g); continue;
    }
    if (s === 'end') { if (!stack.length) fail(line, 'unmatched end'); const g = stack.pop(); g.id ??= `subGraph${subCount}`; subCount++; if (g.id && g.parentObj) g.parentObj.refs.add(g.id); completed.push(g); continue; }
    if ((m = s.match(/^direction\s+(\S+)$/))) { if (!stack.length) fail(line, 'direction outside a subgraph'); const d = dirOf(m[1]); if (!d) fail(line, 'direction', snippet(m[1])); stack.at(-1).direction = d; continue; }
    if ((m = s.match(/^classDef\s+(\S+)\s+(.+)$/))) { addClassDef(m[1], m[2], line); continue; }
    if ((m = s.match(/^class\s+(\S+)\s+([\w-]+)$/))) { for (const id of m[1].split(',')) { if (groupIds.has(id)) continue; const n = nodes.get(id); if (n) n.classes.push(m[2]); else ignored.push({ construct: 'class on a node not yet defined', line }); } continue; }
    if ((m = s.match(/^(style|linkStyle|click)\s/))) { ignored.push({ construct: m[1], line }); continue; }
    if (/^(?:accTitle|accDescr)\s*[:{]/.test(s)) continue;
    parseStatement(s, line);
  }
  if (stack.length) fail(stack.at(-1).line, 'unclosed subgraph', stack.at(-1).id ?? stack.at(-1).title);

  const pathOf = g => (g ? [...pathOf(g.parentObj), g.id] : []);
  // Mermaid (flowDb.addSubGraph/makeUniq): a node or subgraph id belongs to the FIRST completed subgraph whose statements reference it.
  const owner = id => completed.find(g => g.id !== id && g.refs.has(id)) ?? null;
  for (const g of completed) g.mermaidParentObj = owner(g.id);
  const mermaidPathOf = g => { const out = [], seen = new Set(); for (let c = g; c && !seen.has(c); c = c.mermaidParentObj) { seen.add(c); out.unshift(c.id); } return out; };
  // declaredGroupPath (what the audit compares against) = lexical nesting plus explicit re-parenting (a subgraph named by a bare reference inside another subgraph). A node
  // defined outside any subgraph and merely used inside one is NOT re-parented here: that stays an author-intent question.
  const declaredPathOf = g => {
    if (!g) return [];
    const outer = mermaidPathOf(g).slice(0, -1), lexical = pathOf(g).slice(0, -1);
    return [...new Set([...outer, ...lexical])].concat(g.id);
  };
  for (const n of nodes.values()) {
    n.mermaidGroupPath = mermaidPathOf(owner(n.id));
    // User decision 2026-10-03: a node defined only at the top level (never declared inside a subgraph) has no group declaration; its declared membership is the one Mermaid renders.
    n.groupPath = pathOf(n.declGroup); n.group = n.groupPath.at(-1) ?? null;
    n.declaredGroupPath = n.declGroup ? declaredPathOf(n.declGroup) : [...n.mermaidGroupPath];
    n.role = n.classes.at(-1) ?? 'neutral';
    if (n.role !== 'neutral' && !palette[n.role]) palette[n.role] = { fill: NEUTRAL.fill, stroke: NEUTRAL.stroke, text: '#17212b', meaning: n.role, declared: false };
    delete n.declGroup;
  }
  if (!palette.neutral) palette.neutral = { ...NEUTRAL };
  const groups = groupList.map(g => ({ id: g.id, label: g.title, parent: g.parentObj?.id ?? null, mermaidParent: g.mermaidParentObj?.id ?? null, direction: g.direction, order: g.order, path: pathOf(g) }));
  const conflicts = [];
  for (const [nodeId, defs] of definitions) {
    const texts = defs.map(d => d.text), shapes = defs.map(d => d.shape);
    const kinds = [...(new Set(texts).size > 1 ? ['text'] : []), ...(new Set(shapes).size > 1 ? ['shape'] : [])];
    if (kinds.length) conflicts.push({ nodeId, kinds, lines: defs.map(d => d.line), texts, shapes });
  }
  return { sourceHash: sha(source), direction, title, nodes: [...nodes.values()], edges, groupEdges, layoutLinks, groups, palette, notCheckable, conflicts, ignored, sourceBytes: Buffer.byteLength(source, 'utf8') };
}
