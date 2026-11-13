import forgeGlobal from '@/model/globals/forgeGlobal'
import {
  buildMacroNode,
  macroKeyFor,
  resolveIdentity,
  type AddToPageOutcome,
} from '@/utils/byline/addToPage'
import { requestConfluenceJson as request } from '@/utils/byline/confluenceRequest'
import { readTitleDraftRecord, writeAddedRecord } from './pageState'

export type TitleDraftAddOutcome = Omit<AddToPageOutcome, 'result' | 'pageMacroCount'> & {
  result: 'added' | 'already_added' | 'forbidden' | 'conflict' | 'failed'
}

/** Any extension node on the page that belongs to this app. */
export function pageHasOwnMacro(adf: unknown, appId: string): boolean {
  const prefix = `${appId}/`
  let found = false
  const walk = (node: unknown): void => {
    if (found) return
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as any
    const keyOfNode = n.attrs?.extensionKey
    if (typeof keyOfNode === 'string' && keyOfNode.startsWith(prefix)) {
      found = true
      return
    }
    Object.values(n).forEach(walk)
  }
  walk(adf)
  return found
}

/**
 * Insert the drafted diagram at the TOP of the page, once.
 *
 * Race rule: two viewers can both click Add. The loser's PUT gets 409; its
 * retry re-reads the page, sees the winner's macro (or the winner's record) and
 * answers 'already_added' rather than inserting a second diagram. The check
 * runs on every attempt, before every write.
 */
export async function addTitleDraftToPage(
  pageId: string,
  diagram: { id: string; diagramType: string },
  attempt = 0,
): Promise<TitleDraftAddOutcome> {
  const identity = resolveIdentity(forgeGlobal.forgeContext as any)
  const macroKey = macroKeyFor(diagram.diagramType)
  if (!identity || !macroKey) return { result: 'failed', reason: 'unresolved_macro_key' }

  try {
    const read = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=atlas_doc_format`, 'GET')
    if (read.status === 403) return { result: 'forbidden', reason: 'read_forbidden', status: 403 }
    if (!read.ok) return { result: 'failed', reason: 'page_read_failed', status: read.status }
    const page = await read.json()
    const raw = page?.body?.atlas_doc_format?.value
    const version = Number(page?.version?.number)
    if (!raw || !Number.isFinite(version)) return { result: 'failed', reason: 'page_body_missing' }

    const adf = JSON.parse(raw)
    if (!Array.isArray(adf?.content)) return { result: 'failed', reason: 'page_body_unparsable' }

    if (pageHasOwnMacro(adf, identity.appId)) return { result: 'already_added' }
    const record = await readTitleDraftRecord(pageId)
    // An unreadable record does not block: the page scan above is the guard
    // that matters, and the person has just asked for this.
    if (record && !('unknown' in record)) return { result: 'already_added' }

    adf.content.unshift(buildMacroNode(identity, macroKey, diagram.id))

    const write = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, 'PUT', {
      id: String(pageId),
      status: 'current',
      title: page.title,
      version: { number: version + 1, message: 'Added a ZenUML diagram from the page title' },
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
    })
    if (write.status === 403) return { result: 'forbidden', reason: 'write_forbidden', status: 403 }
    if (write.status === 409) {
      if (attempt > 0) return { result: 'conflict' }
      return addTitleDraftToPage(pageId, diagram, attempt + 1)
    }
    if (!write.ok) return { result: 'failed', reason: 'page_write_failed', status: write.status }

    try {
      await writeAddedRecord(pageId, diagram.id)
    } catch (e) {
      console.debug('[title-draft] record write threw', e)
    }
    return { result: 'added' }
  } catch (e) {
    console.error('[title-draft] add failed', e)
    return { result: 'failed', reason: 'threw' }
  }
}
