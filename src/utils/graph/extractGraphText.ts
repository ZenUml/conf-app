// Extract the human-readable text from a DrawIO / mxGraph XML document so the
// AI-title endpoint receives clean signal (the shape/edge labels) instead of
// the full, verbose mxfile markup. Node labels live in the `value` attribute of
// <mxCell> (and in the `label` attribute of the <object>/<UserObject> wrappers
// DrawIO uses when a node carries custom attributes). Those labels can contain
// inline HTML (e.g. "<b>Order</b><br>service"), so we strip tags and collapse
// whitespace.
//
// Returns '' when the XML has no labelled shapes (e.g. the empty starter graph)
// or can't be parsed — the auto-title guard in useAutoTitle treats an empty
// string as "no content" and won't fire.
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

  // Cap the payload so a huge diagram can't balloon the request; the leading
  // labels carry more than enough signal to title the diagram.
  return labels.join('\n').slice(0, 2000);
}

function stripHtml(s: string): string {
  // DrawIO stores labels as entity-encoded HTML; DOMParser already decoded the
  // entities when reading the attribute, so the value is real HTML here. Turn
  // <br> into a space first (so "A<br>B" doesn't collapse to "AB"), then drop
  // any remaining tags.
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
}
