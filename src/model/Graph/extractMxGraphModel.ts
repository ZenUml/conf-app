// DrawIO saved XML comes in two shapes:
//   - <mxGraphModel>...</mxGraphModel>   (legacy single-page records)
//   - <mxfile><diagram><mxGraphModel>...</mxGraphModel></diagram>...</mxfile>
//     (current format from the Forge editor; preserves multi-page state)
//
// mxCodec.decode only understands <mxGraphModel>, so the viewer must extract
// the first page's <mxGraphModel> from any <mxfile> wrapper before decoding.
// Multi-page navigation in the viewer is a separate UX decision; for now we
// render Page-1 and persist every page intact.
export function extractMxGraphModelForViewer(xmlString: string | undefined | null): string {
  if (!xmlString) return '';
  if (xmlString.trimStart().startsWith('<mxGraphModel')) return xmlString;
  try {
    const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');
    const model = xmlDoc.documentElement?.querySelector('mxGraphModel');
    if (!model) return xmlString;
    return new XMLSerializer().serializeToString(model);
  } catch {
    return xmlString;
  }
}
