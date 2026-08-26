import type { Diagram } from '@/model/Diagram/Diagram'
import type { DiagramLoadError } from '@/model/store2/types'
import { normalizeGraphEditorMode, type GraphEditorMode } from '@/utils/graph/graphEditorMode'

/**
 * Board and Diagram are two independent DrawIO documents on one graph macro.
 * Every consumer that reads a graph body needs the same three answers, so they
 * live here instead of being re-derived per surface:
 *
 *   1. which mode the macro was published in,
 *   2. which of the two stored documents that mode owns,
 *   3. whether that document is renderable.
 *
 * The macro config (`graphEditorMode`) is the authority where it is reachable —
 * the primary viewer and the editor both get it from the Forge context. The
 * embed host, the export snapshot and getDiagramData() have no config, so the
 * mode is ALSO written onto the persisted body at publish time and read back
 * from there. Preferring "boardGraphXml when non-empty" instead would be wrong:
 * a publish writes both documents, so a Diagram-mode macro whose owner once
 * drew on the Board would export the Board document.
 */

const RENDERABLE_ROOTS = ['mxfile', 'mxgraphmodel']

/** Mode as recorded on the document itself. Legacy bodies have no value. */
export function graphModeFromDoc(doc: Diagram | undefined): GraphEditorMode | undefined {
  const stored = (doc as { graphEditorMode?: unknown } | undefined)?.graphEditorMode
  return stored === undefined ? undefined : normalizeGraphEditorMode(stored)
}

/**
 * The BODY wins when it records a mode, because it is written in the same
 * publish as the content it describes. The macro config is written by a
 * separate view.submit that several publish paths skip (forge-graph-editor.ts
 * closes the view without submitting when needsWriteback and isConfiguring are
 * both false), so a config value can lag the document by a whole session.
 * Config remains the fallback for legacy bodies that record no mode, and it
 * still drives the editor's own initial chrome.
 */
export function resolveGraphEditorMode(
  doc: Diagram | undefined,
  configMode?: unknown,
): GraphEditorMode {
  const fromDoc = graphModeFromDoc(doc)
  if (fromDoc !== undefined) return fromDoc
  if (configMode !== undefined && configMode !== null) return normalizeGraphEditorMode(configMode)
  return 'diagram'
}

/**
 * Board macros published before boardGraphXml existed stored their body in
 * graphXml, exactly like a Diagram macro. `undefined` (the field was never
 * written) is that legacy shape and MUST fall back. An empty string is a
 * post-migration Board document that is genuinely empty, and stays an error.
 */
export function isLegacyBoardDocument(doc: Diagram | undefined): boolean {
  return !!doc
    && (doc as { boardGraphXml?: unknown }).boardGraphXml === undefined
    && !!doc.graphXml?.trim()
}

/** The XML the given mode owns, after the legacy-Board fallback. */
export function resolveGraphXmlForMode(
  doc: Diagram | undefined,
  mode: GraphEditorMode,
): string | undefined {
  if (!doc) return undefined
  if (mode !== 'board') return doc.graphXml
  if (isLegacyBoardDocument(doc)) return doc.graphXml
  return doc.boardGraphXml
}

/** The XML the document's own recorded mode owns. For config-less surfaces. */
export function resolveGraphXml(doc: Diagram | undefined, configMode?: unknown): string | undefined {
  return resolveGraphXmlForMode(doc, resolveGraphEditorMode(doc, configMode))
}

/**
 * Structural check only — DrawIO's own parser stays the final authority at
 * render time. This exists so a Board macro fails at the load boundary instead
 * of mounting a ready-looking shell and then blanking inside the child.
 * Returns an error code, or null when the XML is renderable.
 */
export function validateBoardXml(xml: unknown): string | null {
  if (xml === undefined) return 'board_document_missing'
  if (typeof xml !== 'string') return 'board_document_malformed'
  if (!xml.trim()) return 'board_document_empty'
  // No DOMParser in some non-browser hosts; defer to the render-time parser.
  if (typeof DOMParser === 'undefined') return null
  try {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    const rootName = parsed.documentElement?.nodeName?.split(':').pop()?.toLowerCase()
    if (
      !rootName
      || parsed.getElementsByTagName('parsererror').length > 0
      || !RENDERABLE_ROOTS.includes(rootName)
    ) {
      return 'board_document_malformed'
    }
  } catch {
    return 'board_document_malformed'
  }
  return null
}

/**
 * `terminal` marks this as an error that must beat a displayable document:
 * a legacy graphXml is present and renderable on a Board macro, so without it
 * classifyViewerLoadOutcome would report `ready` and show the wrong surface.
 */
export function getBoardDocumentLoadError(doc: Diagram | undefined): DiagramLoadError | null {
  if (!doc) return null
  if (isLegacyBoardDocument(doc)) return null
  const errorCode = validateBoardXml(doc.boardGraphXml)
  if (!errorCode) return null
  return { errorClass: 'malformed', errorCode, terminal: true }
}
