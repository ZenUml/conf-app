import forgeGlobal from '@/model/globals/forgeGlobal'
import { referencedCustomContentId } from '@/model/page/referencedCustomContent'
import { requestConfluenceJson as request } from '@/utils/byline/confluenceRequest'
import { deleteTitleDraftRecord } from './pageState'

export interface UndoOutcome {
  result: 'undone' | 'not_found' | 'conflict' | 'forbidden' | 'failed'
}

/** Best effort: delete the custom content. Never throws. */
export async function discardCustomContent(contentId: string): Promise<void> {
  try {
    await request(`/wiki/api/v2/custom-content/${encodeURIComponent(contentId)}`, 'DELETE')
  } catch (e) {
    console.debug('[title-draft] discard custom content failed', e)
  }
}

/** Remove every node that references contentId; returns how many were removed. */
function removeReferences(node: unknown, contentId: string, cloudId: string | undefined): number {
  if (!node || typeof node !== 'object') return 0
  let removed = 0
  const n = node as any
  if (Array.isArray(n.content)) {
    const kept: unknown[] = []
    for (const child of n.content) {
      const id = referencedCustomContentId((child as any)?.attrs?.parameters, cloudId)
      if (id && String(id) === String(contentId)) {
        removed++
      } else {
        removed += removeReferences(child, contentId, cloudId)
        kept.push(child)
      }
    }
    n.content = kept
  }
  return removed
}

/** Take the drafted diagram back off the page, in one new page version. */
export async function undoTitleDraft(pageId: string, contentId: string, attempt = 0): Promise<UndoOutcome> {
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

    const removed = removeReferences(adf, contentId, forgeGlobal.forgeContext?.cloudId)
    if (removed === 0) return { result: 'not_found' }

    const write = await request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, 'PUT', {
      id: String(pageId),
      status: 'current',
      title: page.title,
      version: { number: version + 1, message: 'Removed the ZenUML diagram added from the page title' },
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
    })
    if (write.status === 403) return { result: 'forbidden' }
    if (write.status === 409) {
      if (attempt > 0) return { result: 'conflict' }
      return undoTitleDraft(pageId, contentId, attempt + 1)
    }
    if (!write.ok) return { result: 'failed' }

    try {
      await deleteTitleDraftRecord(pageId)
    } catch (e) {
      console.debug('[title-draft] record delete threw', e)
    }
    await discardCustomContent(contentId)
    return { result: 'undone' }
  } catch (e) {
    console.error('[title-draft] undo failed', e)
    return { result: 'failed' }
  }
}
