/**
 * Attachment-based diagram recovery.
 *
 * When a viewer can no longer access custom content (403/404), this module
 * fetches the PNG attachment that was saved alongside the macro and extracts
 * the zenumlDiagram iTXt chunk embedded there. It then reconstructs a Diagram
 * object so the viewer can render (and the editor can edit) the original source.
 */

import { DataSource, Diagram, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { extractDiagramSource, type DiagramPayload } from '@/utils/pngMetadata';

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

function reconstructDiagram(payload: DiagramPayload, customContentId: string): Diagram {
  const dt = parseDiagramType(payload.diagramType);
  // Preserve the original CC id so callers can detect id changes on save
  // (sourceId → newId diff triggers view.submit writeback in insert/configure contexts).
  const base: Diagram = { ...NULL_DIAGRAM, id: customContentId, diagramType: dt, source: DataSource.PngAttachment, recoveredFromOrphan: true };
  switch (dt) {
    case DiagramType.Graph:   return { ...base, graphXml: payload.source };
    case DiagramType.Mermaid: return { ...base, mermaidCode: payload.source };
    case DiagramType.PlantUml: return { ...base, plantUmlCode: payload.source };
    default:                  return { ...base, code: payload.source };
  }
}

/**
 * Try to recover a diagram from the PNG attachment saved for `customContentId`
 * on page `pageId`. Returns a reconstructed Diagram, or null if unavailable.
 *
 * This is intentionally best-effort: any error (no attachment, no chunk,
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

    // _links.download from V2 API is a Confluence-relative path that may or may
    // not carry the /wiki prefix (e.g. "/download/attachments/..." vs "/wiki/...").
    // requestConfluence (Forge bridge) requires the /wiki prefix.
    const rawDownload = (attachments[0] as any)._links?.download as string | undefined;
    if (!rawDownload) return null;
    const downloadPath = rawDownload.startsWith('/wiki/') ? rawDownload : `/wiki${rawDownload}`;

    // forgeRequest always calls .json(), so use requestConfluence directly for binary
    const { requestConfluence } = await import('@forge/bridge');
    const response = await requestConfluence(downloadPath);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const payload = await extractDiagramSource(arrayBuffer);
    if (!payload) return null;

    console.debug('PNG attachment recovery succeeded for', customContentId, 'type:', payload.diagramType);
    return reconstructDiagram(payload, customContentId);
  } catch (e) {
    console.warn('PNG attachment recovery failed for', customContentId, e);
    return null;
  }
}
