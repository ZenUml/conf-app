import { DiagramType } from '@/model/Diagram/Diagram'

/**
 * "New diagram" deeplinks — the paste-to-create half of the byline picker.
 *
 * There is no API that inserts a macro into the Confluence editor from another
 * iframe, so picking a type in the byline modal cannot place the macro for the
 * user. What Confluence does support is `autoConvert`: a macro declares URL
 * patterns, and pasting a matching URL into the editor turns it into that
 * macro, at the cursor.
 *
 * The mechanism is already proven in this codebase — see
 * docs/superpowers/plans/2026-07-16-embed-autoconvert-deeplink-spike.md, which
 * shipped matchers on the embed macro and verified end to end that conversion
 * fires in both the current editor and Live Docs, that the URL never needs to
 * resolve (matching is editor-local; the host 404s to this day), and that the
 * matched URL persists in the page ADF as `parameters.autoConvertLink`. That
 * spike converted a link to an EXISTING diagram; this one converts a link into
 * a NEW, empty diagram of a chosen type, which is the same mechanism applied to
 * a different job and is what the spike still has to confirm.
 *
 * The link deliberately carries no page, space or tenant: it means "a new
 * diagram of this type", so it is safe to paste anywhere, including a different
 * site, and stays valid indefinitely.
 */

export const NEW_DIAGRAM_LINK_BASE = 'https://confluence.zenuml.com/new'

/** Path segment -> the type the editor should start in. The segment names are
 *  the user-facing types, not the storage `diagramType` values, so the URL a
 *  user might see or share reads sensibly. */
const TYPE_BY_SEGMENT: Record<string, DiagramType> = {
  sequence: DiagramType.Sequence,
  mermaid: DiagramType.Mermaid,
  plantuml: DiagramType.PlantUml,
  graph: DiagramType.Graph,
  openapi: DiagramType.OpenApi,
}

const SEGMENT_BY_TYPE: Record<string, string> = {
  [DiagramType.Sequence]: 'sequence',
  [DiagramType.Mermaid]: 'mermaid',
  [DiagramType.PlantUml]: 'plantuml',
  [DiagramType.Graph]: 'graph',
  [DiagramType.OpenApi]: 'openapi',
}

/** The link to put on the clipboard for a chosen type. Returns undefined for a
 *  type with no matcher in the manifest, so a caller can never hand the user a
 *  URL that would paste as a plain link. */
export function buildNewDiagramLink(diagramType: string): string | undefined {
  const segment = SEGMENT_BY_TYPE[diagramType]
  return segment ? `${NEW_DIAGRAM_LINK_BASE}/${segment}` : undefined
}

/**
 * The type an autoConvertLink asks for, or undefined when the value is absent,
 * malformed, or not one of ours. Undefined must leave existing behaviour
 * untouched — a macro that was not created by a paste has no link at all, and
 * that is the overwhelmingly common case.
 */
export function parseNewDiagramLink(link: unknown): DiagramType | undefined {
  if (typeof link !== 'string' || !link) return undefined
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  if (url.host !== 'confluence.zenuml.com') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'new') return undefined
  return TYPE_BY_SEGMENT[parts[1].toLowerCase()]
}

/**
 * Read the link out of a Forge extension context. The manifest reference says
 * the matched URL is "inserted as a parameter into the macro body ... accessed
 * using the `autoConvertLink` property", and the spike observed it on the ADF
 * node's `parameters`. Both shapes are read because the exact context path is
 * the thing this spike is meant to confirm on a real paste — reading one and
 * guessing wrong would look identical to "autoConvert didn't fire".
 */
export function readAutoConvertLink(context: any): string | undefined {
  return (
    context?.extension?.config?.autoConvertLink ||
    context?.extension?.autoConvertLink ||
    context?.extension?.parameters?.autoConvertLink ||
    undefined
  )
}

/**
 * Apply a paste-to-create link to the doc a fresh macro is about to mount with.
 *
 * Extracted and unit-tested because the *guard* is where this went wrong the
 * first time: the original inline version skipped when a doc already existed,
 * which silently excluded the sequence family — it assigns its own placeholder
 * doc (diagramType Sequence, example bodies pre-filled) before this point,
 * while graph and openapi leave the doc undefined. Measured 2026-08-01:
 * `/new/graph` and `/new/openapi` seeded, `/new/mermaid` pasted as a sequence
 * diagram.
 *
 * `hasStoredContent` is the real "leave it alone" signal — a macro with a
 * customContentId has a type of its own that must always win.
 */
export function applyNewDiagramLink<T extends { diagramType?: string }>(
  doc: T | undefined,
  link: unknown,
  hasStoredContent: boolean,
): { doc: T | undefined; seededType?: DiagramType } {
  if (hasStoredContent) return { doc }
  const seededType = parseNewDiagramLink(link)
  if (!seededType) return { doc }
  // Keep the placeholder's example bodies and isNew flag; only the type moves.
  const next = (doc ? { ...doc, diagramType: seededType } : { diagramType: seededType }) as T
  return { doc: next, seededType }
}
