import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'

/**
 * Place a saved diagram on its page in one click.
 *
 * The alternative this replaces is four steps — copy the link, open the editor,
 * paste, publish — and an unplaced diagram exists precisely because somebody
 * already abandoned that flow once. So the app writes the macro into the page
 * ADF itself and publishes one new version.
 *
 * WHAT IT WRITES. A Forge macro node, modelled on a real one captured from
 * lite-stg page 260473240 on 2026-09-05 rather than invented:
 *
 *   { type: 'extension', attrs: {
 *       extensionType: 'com.atlassian.ecosystem',
 *       extensionKey: '<appId>/<environmentId>/static/<macroKey>',
 *       parameters: { guestParams: { customContentId, updatedAt }, ... } } }
 *
 * The `extensionKey` is the fragile part and the one with scar tissue:
 * src/lite-full-conversion.ts records that a malformed key rendered as an
 * unknown extension on the first live conversion (2026-08-11, job c5a6d954).
 * Both ids come from the running Forge context — `environmentId` is given to us
 * directly, and `localId` carries appId and environmentId as fixed-length UUIDs
 * — and we refuse to write at all unless the two agree (see `resolveIdentity`).
 *
 * WHAT IT DOES NOT DO. It appends to the end of the document, because nothing
 * here knows where the author wanted it; it never rewrites or removes an
 * existing node; and it never force-publishes over a concurrent edit. Every
 * write is one ordinary page version, so page history reverts it.
 */

export type AddToPageResult =
  | 'added'
  | 'already_present'
  | 'forbidden'
  | 'conflict'
  | 'failed'

export interface AddToPageOutcome {
  result: AddToPageResult
  /** Macros the page already carried, for the paywall/limit read. */
  pageMacroCount?: number
}

/**
 * Which macro renders which diagram. The text-DSL family shares one macro —
 * `zenuml-sequence-macro` hosts sequence, mermaid and plantuml, exactly as they
 * share the `zenuml-content-sequence` custom-content type.
 */
const MACRO_KEY_BY_DIAGRAM_TYPE: Record<string, string> = {
  [DiagramType.Sequence]: 'zenuml-sequence-macro',
  [DiagramType.Mermaid]: 'zenuml-sequence-macro',
  [DiagramType.PlantUml]: 'zenuml-sequence-macro',
  [DiagramType.Graph]: 'zenuml-graph-macro',
  [DiagramType.OpenApi]: 'zenuml-openapi-macro',
  [DiagramType.AsyncApi]: 'zenuml-asyncapi-macro',
}

/** Fold case, like pageDiagrams.lookup: stored types spell OpenAPI/openapi. */
function macroKeyFor(diagramType: string): string | null {
  const exact = MACRO_KEY_BY_DIAGRAM_TYPE[diagramType]
  if (exact) return withVariantSuffix(exact)
  const folded = String(diagramType ?? '').toLowerCase()
  const key = Object.keys(MACRO_KEY_BY_DIAGRAM_TYPE).find(k => k.toLowerCase() === folded)
  return key ? withVariantSuffix(MACRO_KEY_BY_DIAGRAM_TYPE[key]) : null
}

/** Lite's macro keys carry `-lite`, matching ${LITE_KEY_SUFFIX} in the manifest. */
function withVariantSuffix(macroKey: string): string {
  return import.meta.env.PRODUCT_TYPE === 'lite' ? `${macroKey}-lite` : macroKey
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const LOCAL_ID_RE = new RegExp(`^ari-cloud-ecosystem--extension-(${UUID})-(${UUID})-static-`)

/**
 * The app and environment this iframe is running as.
 *
 * `localId` is the ARI with every `/` and `:` flattened to `-`, so the two
 * UUIDs can only be pulled out by their fixed shape — which is unambiguous,
 * because a UUID's segment lengths are fixed. The environment is then checked
 * against the context's own `environmentId`: if a future Forge change alters
 * either shape they stop agreeing, and we write nothing rather than write a key
 * that renders as an unknown extension on a customer's page.
 */
export function resolveIdentity(
  context: { localId?: string; environmentId?: string } | undefined,
): { appId: string; environmentId: string } | null {
  const match = LOCAL_ID_RE.exec(context?.localId ?? '')
  if (!match) return null
  const [, appId, environmentId] = match
  if (context?.environmentId && context.environmentId !== environmentId) return null
  return { appId, environmentId }
}

/** The macro node, in the shape Confluence writes when a user inserts one. */
export function buildMacroNode(
  identity: { appId: string; environmentId: string },
  macroKey: string,
  customContentId: string,
  now: number = Date.now(),
): Record<string, unknown> {
  const path = `${identity.appId}/${identity.environmentId}/static/${macroKey}`
  return {
    type: 'extension',
    attrs: {
      layout: 'default',
      extensionType: 'com.atlassian.ecosystem',
      extensionKey: path,
      parameters: {
        layout: 'extension',
        extensionId: `ari:cloud:ecosystem::extension/${path}`,
        // The macro reads this on render; everything else in a
        // Confluence-authored node is editor context it rebuilds for itself.
        guestParams: {
          customContentId: String(customContentId),
          updatedAt: new Date(now).toISOString(),
        },
      },
      localId: cryptoRandomId(),
    },
  }
}

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `zenuml-${Math.random().toString(36).slice(2)}-${Date.now()}`
  }
}

/** Does this document already reference the diagram? */
export function referencesCustomContent(adf: unknown, customContentId: string): boolean {
  let found = false
  const walk = (node: unknown): void => {
    if (found) return
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as any
    const params = n.attrs?.parameters
    for (const p of [params?.guestParams, params?.macroParams, params]) {
      const raw = p?.customContentId
      const id = typeof raw === 'string' ? raw : raw?.value
      if (id && String(id) === String(customContentId)) {
        found = true
        return
      }
    }
    Object.values(n).forEach(walk)
  }
  walk(adf)
  return found
}

function countExtensions(adf: unknown): number {
  let count = 0
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as any
    if (typeof n.type === 'string' && ['extension', 'bodiedExtension', 'inlineExtension'].includes(n.type)) {
      count++
    }
    Object.values(n).forEach(walk)
  }
  walk(adf)
  return count
}

async function request(url: string, method: string, body?: unknown) {
  const { requestConfluence } = await import('@forge/bridge')
  return requestConfluence(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/**
 * Append the diagram's macro to the page and publish one new version.
 *
 * Runs as the USER, so a reader who cannot edit gets 'forbidden' — an expected
 * outcome on a notice that reaches every reader, and the caller falls back to
 * handing over the link.
 */
export async function addDiagramToPage(
  pageId: string,
  diagram: { id: string; diagramType: string },
  attempt = 0,
): Promise<AddToPageOutcome> {
  const identity = resolveIdentity(forgeGlobal.forgeContext as any)
  const macroKey = macroKeyFor(diagram.diagramType)
  // Refuse rather than write a key we are not sure of: a malformed extensionKey
  // renders as an unknown extension, which is worse on a customer's page than
  // the link we would otherwise offer.
  if (!identity || !macroKey) return { result: 'failed' }

  try {
    const read = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=atlas_doc_format`, 'GET')
    if (read.status === 403) return { result: 'forbidden' }
    if (!read.ok) return { result: 'failed' }
    const page = await read.json()
    const raw = page?.body?.atlas_doc_format?.value
    const version = Number(page?.version?.number)
    if (!raw || !Number.isFinite(version)) return { result: 'failed' }

    const adf = JSON.parse(raw)
    if (!Array.isArray(adf?.content)) return { result: 'failed' }
    const pageMacroCount = countExtensions(adf)
    // Someone else placed it, or this is a second click on the same button.
    if (referencesCustomContent(adf, diagram.id)) {
      return { result: 'already_present', pageMacroCount }
    }

    adf.content.push(buildMacroNode(identity, macroKey, diagram.id))

    const write = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, 'PUT', {
      id: String(pageId),
      status: 'current',
      title: page.title,
      version: { number: version + 1, message: 'Added a ZenUML diagram from the byline' },
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
    })
    if (write.status === 403) return { result: 'forbidden', pageMacroCount }
    // The page moved under us. Re-read and try once — never force, because the
    // version we would overwrite is somebody's edit.
    if (write.status === 409) {
      if (attempt > 0) return { result: 'conflict', pageMacroCount }
      return addDiagramToPage(pageId, diagram, attempt + 1)
    }
    if (!write.ok) return { result: 'failed', pageMacroCount }
    return { result: 'added', pageMacroCount }
  } catch (e) {
    console.error('[add-to-page] failed', e)
    return { result: 'failed' }
  }
}
