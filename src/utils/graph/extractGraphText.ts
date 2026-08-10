// Extract signal from a DrawIO / mxGraph XML document so the AI-title endpoint
// gets something clean to work with instead of the full, verbose mxfile markup.
//
// Two tiers, best signal first:
//   1. Text labels — the human-written text on shapes/edges (mxCell `value`,
//      object/UserObject `label`). This is the strongest signal.
//   2. Shape descriptors — when a diagram has no labels at all, fall back to the
//      shape *types* encoded in each cell's `style` (stencil names like
//      mxgraph.aws4.ec2 / resIcon / grIcon, or geometric primitives like
//      rhombus/cylinder). Great for shape-library diagrams (AWS/Azure/UML/
//      network); necessarily generic for plain unlabelled boxes.
//
// Returns '' when the XML has no labelled shapes AND no describable shapes
// (e.g. the empty starter graph) or can't be parsed — the auto-title guard in
// useAutoTitle treats an empty string as "no content" and won't fire.
export function extractGraphText(xml: string | null | undefined): string {
  if (!xml || typeof xml !== 'string') return '';

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return '';
  }
  // DOMParser reports malformed XML as a <parsererror> node rather than
  // throwing, so check for it explicitly.
  if (doc.getElementsByTagName('parsererror').length > 0) return '';

  const labels = collectLabels(doc);
  if (labels.length > 0) return labels.join('\n').slice(0, 2000);

  // No text anywhere — describe the shapes instead.
  return describeShapes(doc).slice(0, 2000);
}

function collectLabels(doc: Document): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null) => {
    if (!raw) return;
    const text = stripHtml(raw).replace(/\s+/g, ' ').trim();
    // De-dup identical labels (a swimlane title repeated on many cells, etc.)
    // so the model sees distinct signal, not the same word 50 times.
    if (text && !seen.has(text)) {
      seen.add(text);
      labels.push(text);
    }
  };

  const cells = doc.getElementsByTagName('mxCell');
  for (let i = 0; i < cells.length; i++) push(cells[i].getAttribute('value'));

  for (const tag of ['object', 'UserObject']) {
    const objs = doc.getElementsByTagName(tag);
    for (let i = 0; i < objs.length; i++) push(objs[i].getAttribute('label'));
  }

  return labels;
}

// Build a short natural-language description of the diagram's shapes and how
// many connectors join them, e.g.
//   "Diagram shapes: 3× ec2, 2× rds, 1× s3, 4× box. 7 connectors."
// Returns '' for a trivial/empty canvas (fewer than 2 shapes and no recognised
// library stencil) so we don't emit a silly title for a single blank box.
function describeShapes(doc: Document): string {
  const counts = new Map<string, number>();
  let vertexCount = 0;
  let edgeCount = 0;
  let hasNamedStencil = false;

  const cells = doc.getElementsByTagName('mxCell');
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.getAttribute('edge') === '1') {
      edgeCount += 1;
      continue;
    }
    if (cell.getAttribute('vertex') !== '1') continue;
    vertexCount += 1;
    const { name, named } = shapeFromStyle(cell.getAttribute('style'));
    if (named) hasNamedStencil = true;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  // Nothing worth titling: a lone blank box (or an empty canvas) has no story.
  if (vertexCount < 2 && !hasNamedStencil) return '';

  // Most-common shapes first, capped so a giant diagram stays concise.
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => (n > 1 ? `${n}× ${name}` : name));

  let out = `Diagram shapes: ${parts.join(', ')}.`;
  if (edgeCount > 0) out += ` ${edgeCount} connector${edgeCount === 1 ? '' : 's'}.`;
  return out;
}

// Generic library-prefixes stripped from stencil ids so "mxgraph.aws4.ec2"
// reads as "ec2". Also the meaningless wrapper stencils we skip in favour of a
// geometric primitive / generic "box".
const GENERIC_STENCILS = new Set([
  'resourceicon', 'group', 'image', 'none', 'label', 'text', 'rect', 'rectangle',
]);

const PRIMITIVES = new Set([
  'ellipse', 'rhombus', 'triangle', 'cylinder', 'cloud', 'actor', 'hexagon',
  'parallelogram', 'step', 'trapezoid', 'tape', 'callout', 'card', 'note',
  'process', 'document', 'internalstorage', 'cube', 'star', 'or', 'and', 'xor',
]);

function shapeFromStyle(style: string | null): { name: string; named: boolean } {
  if (!style) return { name: 'box', named: false };

  const map: Record<string, string> = {};
  const bare: string[] = [];
  for (const part of style.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq >= 0) map[p.slice(0, eq)] = p.slice(eq + 1);
    else bare.push(p.toLowerCase());
  }

  // Library stencils carry the most meaning (AWS/Azure/GCP/mxgraph). resIcon /
  // grIcon are AWS resource/group icons; `shape` covers the rest.
  const stencil = map['resIcon'] || map['grIcon'] || map['shape'];
  if (stencil) {
    const last = (stencil.split('.').pop() || stencil).toLowerCase();
    // Split camelCase (virtualMachine -> virtual machine) but NOT letter/digit
    // boundaries, so resource names like ec2 / s3 / aws4 stay intact.
    const cleaned = last.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (cleaned && !GENERIC_STENCILS.has(cleaned)) {
      return { name: cleaned, named: true };
    }
    // shape=cylinder etc. is a primitive, not a library icon.
    if (PRIMITIVES.has(last)) return { name: last, named: false };
  }

  // Geometric primitives are often expressed as a bare token in the style.
  for (const token of bare) {
    if (PRIMITIVES.has(token)) return { name: token, named: false };
  }

  if (map['rounded'] === '1') return { name: 'rounded box', named: false };
  return { name: 'box', named: false };
}

function stripHtml(s: string): string {
  // DrawIO stores labels as entity-encoded HTML; DOMParser already decoded the
  // entities when reading the attribute, so the value is real HTML here. Turn
  // <br> into a space first (so "A<br>B" doesn't collapse to "AB"), then drop
  // any remaining tags.
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
}
