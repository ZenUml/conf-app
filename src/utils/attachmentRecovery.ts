/**
 * Attachment-based diagram recovery.
 *
 * When a viewer can no longer access custom content (403/404), this module
 * finds the PNG attachment saved alongside the macro and reads the zenuml-source
 * content property stored on it. It then reconstructs a Diagram object so the
 * viewer can render (and the editor can edit) the original source.
 *
 * Why content property instead of PNG iTXt:
 *   requestConfluence from @forge/bridge returns 401 for /download/attachments/
 *   URLs — the api.atlassian.com/ex/confluence gateway is REST-only and does not
 *   support binary content-delivery paths. Content properties use the standard
 *   REST API and work correctly.
 */

import { DataSource, Diagram, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';

function parseDiagramType(type: string): DiagramType {
  switch (type.toLowerCase()) {
    case 'graph': return DiagramType.Graph;
    case 'mermaid': return DiagramType.Mermaid;
    case 'plantuml': return DiagramType.PlantUml;
    case 'openapi': return DiagramType.OpenApi;
    case 'embed': return DiagramType.Embed;
    default: return DiagramType.Sequence;
  }
}

function reconstructDiagram(diagramType: string, source: string, customContentId: string): Diagram {
  const dt = parseDiagramType(diagramType);
  // Preserve the original CC id so callers can detect id changes on save
  // (sourceId → newId diff triggers view.submit writeback in insert/configure contexts).
  const base: Diagram = { ...NULL_DIAGRAM, id: customContentId, diagramType: dt, source: DataSource.PngAttachment, recoveredFromOrphan: true };
  switch (dt) {
    case DiagramType.Graph:   return { ...base, graphXml: source };
    case DiagramType.Mermaid: return { ...base, mermaidCode: source };
    case DiagramType.PlantUml: return { ...base, plantUmlCode: source };
    default:                  return { ...base, code: source };
  }
}

/**
 * Try to recover a diagram from the content property stored on the PNG attachment
 * saved for `customContentId` on page `pageId`.
 * Returns a reconstructed Diagram, or null if unavailable.
 *
 * This is intentionally best-effort: any error (no attachment, no property,
 * network failure) returns null so the caller falls through gracefully.
 */
export async function tryExtractFromPngAttachment(
  pageId: string,
  customContentId: string,
): Promise<Diagram | null> {
  try {
    const { default: globals } = await import('@/model/globals');
    const attachmentName = `zenuml-${customContentId}.png`;
    const attachments = await globals.apWrapper.getAttachmentsV2(pageId, { filename: attachmentName });
    if (!attachments?.length) return null;

    // V2 API returns att-prefixed IDs (e.g. "att83525676").
    // V1 content property API requires the numeric portion only.
    const rawId = (attachments[0] as any).id as string | undefined;
    if (!rawId) return null;
    const numericId = rawId.startsWith('att') ? rawId.slice(3) : rawId;

    const { forgeRequest } = await import('@/utils/requestUtil');
    const property = await forgeRequest(`/wiki/rest/api/content/${numericId}/property/zenuml-source`).catch(() => null);
    if (!property?.value?.diagramType || !property?.value?.source) return null;

    console.debug('PNG attachment recovery succeeded for', customContentId, 'type:', property.value.diagramType);
    return reconstructDiagram(property.value.diagramType, property.value.source, customContentId);
  } catch (e) {
    console.warn('PNG attachment recovery failed for', customContentId, e);
    return null;
  }
}
