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
// writeDiagram only persists (saveCustomContentV2) — it does NOT, by itself,
// make the currently-mounted macro redraw. Confluence custom-content has no
// push/refetch back into a running iframe, so bumping the version here is
// invisible to this session until relayClient.ts's onDiagramUpdated callback
// (fired only once this write resolves {ok:true}) drives a store.dispatch of
// the same action the in-app code editor uses (see GenericViewer.vue's
// applyAgentDiagramUpdate). rendered:true here means "this write, once
// wired through that callback, always causes a render" — not that this
// function renders anything on its own.

import type ApWrapper2 from '@/model/ApWrapper2'
import type { DiagramSearchHit } from '@/model/ApWrapper2'
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram'
import { getDiagramConfig } from '@/model/Diagram/DiagramTypeConfig'
import type {
  AgentLinkBridge,
  AgentLinkDiagramRow,
  SearchDiagramsParams,
  ListDiagramsParams,
} from './bridgeOps'

export interface AgentLinkBridgeContext {
  apWrapper: ApWrapper2
}

// Discovery defaults (design §S3/S4). The agent's tool sees a small, re-rankable
// candidate set; MAX caps the body-enrich fan-out cost per search/list call.
const DEFAULT_DISCOVERY_LIMIT = 10
const MAX_DISCOVERY_LIMIT = 25

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_DISCOVERY_LIMIT
  return Math.min(Math.floor(limit), MAX_DISCOVERY_LIMIT)
}

function hitToRow(hit: DiagramSearchHit): AgentLinkDiagramRow {
  return {
    contentId: hit.contentId,
    title: hit.title,
    diagramType: hit.diagramType,
    spaceKey: hit.spaceKey,
    pageId: hit.pageId,
    excerpt: hit.excerpt,
    lastModified: hit.lastModified,
  }
}

// Exact diagram-type post-filter (design §4): sequence/mermaid/plantuml/openapi
// share ONE custom-content type, so the CQL clause can't discriminate them —
// filter on the body's real diagramType here. Case-insensitive; absent/empty
// `types` keeps everything.
function filterByTypes(hits: DiagramSearchHit[], types?: string[]): DiagramSearchHit[] {
  if (!types || types.length === 0) return hits
  const wanted = new Set(types.map((t) => String(t).toLowerCase()))
  return hits.filter((h) => wanted.has(String(h.diagramType).toLowerCase()))
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
      // S2/S5: works for the bound diagram AND a discovered hit. readDiagramForAgent
      // uses the raw fetch (no cross-page-copy detection) and returns the exact
      // diagramType + title/pageId/version — enough to pull-to-local (design §3).
      const result = await apWrapper.readDiagramForAgent(contentId)
      if (!result) {
        return { contentId, diagramType: DiagramType.Unknown, title: '', dsl: '' }
      }
      return result
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

    // S3: topic search across the estate. ApWrapper2 owns the CQL primitive +
    // body-enrich (returns exact diagramType); this executor applies the exact
    // type post-filter and the final limit, then maps hits → rows. Over-fetch
    // candidates when a type filter is active so filtering doesn't under-fill.
    async searchDiagrams(params: SearchDiagramsParams): Promise<AgentLinkDiagramRow[]> {
      const limit = clampLimit(params.limit)
      const hasTypeFilter = Array.isArray(params.types) && params.types.length > 0
      const maxCandidates = hasTypeFilter ? Math.min(limit * 3, 50) : limit
      const hits = await apWrapper.searchDiagramsForge({
        query: params.query,
        spaceKey: params.spaceKey,
        types: params.types,
        maxCandidates,
      })
      return filterByTypes(hits, params.types).slice(0, limit).map(hitToRow)
    },

    // S4: recency-ordered browse over the SAME plumbing (no query). Scope by
    // space via CQL; scope by page is a post-filter (custom-content page
    // containment isn't a CQL-filterable field — evidence §4 only verified
    // type/text/space/cross-space).
    async listDiagrams(params: ListDiagramsParams): Promise<AgentLinkDiagramRow[]> {
      const limit = clampLimit(params.limit)
      const hasTypeFilter = Array.isArray(params.types) && params.types.length > 0
      const hasPageFilter = typeof params.pageId === 'string' && params.pageId !== ''
      const maxCandidates = hasTypeFilter || hasPageFilter ? Math.min(limit * 3, 50) : limit
      const hits = await apWrapper.searchDiagramsForge({
        spaceKey: params.spaceKey,
        types: params.types,
        maxCandidates,
      })
      let rows = filterByTypes(hits, params.types)
      if (hasPageFilter) rows = rows.filter((h) => String(h.pageId) === String(params.pageId))
      return rows.slice(0, limit).map(hitToRow)
    },
  }
}
