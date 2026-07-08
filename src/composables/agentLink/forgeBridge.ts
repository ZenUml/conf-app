// src/composables/agentLink/forgeBridge.ts
//
// The REAL AgentLinkBridge (design §4.2, §4.4) — backed by conf-app's
// existing Confluence I/O. This is the implementation bridgeOps.ts's TODO
// calls for: it reuses ApWrapper2's own store-contract methods instead of
// reconstructing request shapes, so:
//   - readPage()            -> ApWrapper2.getCurrentPage() (same v2 pages
//     read every other page-body consumer in this app would use)
//   - readDiagram(id)        -> ApWrapper2.getCustomContentForCurrentPage(id)
//     (the exact read CustomContentStorageProvider.getDiagram() uses)
//   - writeDiagram(id, dsl)  -> ApWrapper2.saveCustomContentV2(id, diagram)
//     (the exact create-vs-update + v2 body-shape logic
//     CustomContentStorageProvider.save() uses — status:"current" +
//     version.number increment happen inside it, not duplicated here)
//
// Because the bound macro already exists on the page, an update always
// renders (design §4.2) — writeDiagram's success result hardcodes
// rendered:true, matching the design's stated invariant.

import type ApWrapper2 from '@/model/ApWrapper2'
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram'
import { getCodeFromDiagram, getDiagramConfig } from '@/model/Diagram/DiagramTypeConfig'
import type { AgentLinkBridge } from './bridgeOps'

export interface AgentLinkBridgeContext {
  apWrapper: ApWrapper2
}

// Minimal HTML -> plain text for read_page (design §4.4): strip tags/scripts/
// styles, decode the handful of entities Confluence's export_view HTML
// actually emits, collapse whitespace. This is context for the agent, not a
// faithful re-render — a full HTML/ADF parser is overkill for MVP scope
// (design §12 explicitly defers ADF authoring).
function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function createForgeAgentLinkBridge(ctx: AgentLinkBridgeContext): AgentLinkBridge {
  const { apWrapper } = ctx

  return {
    async readPage() {
      const pageId = await apWrapper._getCurrentPageId()
      const page = await apWrapper.getCurrentPage()
      const html = page?.body?.export_view?.value || ''
      return {
        pageId: pageId != null ? String(pageId) : '',
        title: page?.title || '',
        text: htmlToPlainText(html),
      }
    },

    async readDiagram(contentId: string) {
      const customContent = await apWrapper.getCustomContentForCurrentPage(contentId)
      // @ts-ignore — parsed diagram is attached as `.value` (see ApWrapper2's
      // parseCustomContentByIdV2Response), same shape CustomContentStorageProvider
      // reads via getDiagram().
      const diagram = customContent?.value as Diagram | undefined
      const diagramType = diagram?.diagramType ?? DiagramType.Unknown
      return {
        contentId,
        diagramType,
        dsl: diagram ? getCodeFromDiagram(diagram, diagramType) : '',
      }
    },

    async writeDiagram(contentId: string, dsl: string) {
      try {
        const customContent = await apWrapper.getCustomContentForCurrentPage(contentId)
        // @ts-ignore — see readDiagram above.
        const diagram = customContent?.value as Diagram | undefined
        if (!diagram) {
          console.error('AgentLinkBridge writeDiagram: bound diagram not found', contentId)
          return { ok: false }
        }
        const config = getDiagramConfig(diagram.diagramType)
        if (!config) {
          console.error('AgentLinkBridge writeDiagram: unsupported diagramType', diagram.diagramType)
          return { ok: false }
        }
        const updated: Diagram = { ...diagram, [config.dataField]: dsl }
        const result = await apWrapper.saveCustomContentV2(contentId, updated)
        return { ok: true, version: result?.version?.number, rendered: true }
      } catch (e) {
        console.error('AgentLinkBridge writeDiagram failed', e)
        return { ok: false }
      }
    },
  }
}
