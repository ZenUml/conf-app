import { requestConfluenceJson as request } from '@/utils/byline/confluenceRequest'

/**
 * The page's title-draft record, stored as a Confluence CONTENT PROPERTY.
 *
 * "One offer per page": once anyone adds the drafted diagram, nobody is offered
 * it again. That has to be page state, not browser state, so it is a content
 * property (same mechanism and REST shapes as utils/byline/unplacedProperty.ts).
 *
 * The key is variant-suffixed for the same reason as the unplaced key: content
 * properties are site-global across apps, so an unsuffixed key would let Full
 * read a record Lite wrote.
 */
export const TITLE_DRAFT_PROPERTY_KEY = titleDraftPropertyKeyFor(import.meta.env.PRODUCT_TYPE)

export function titleDraftPropertyKeyFor(productType: string | undefined): string {
  switch (productType) {
    case 'lite':
      return 'zenuml-title-draft-lite'
    case 'asyncapi':
      return 'zenuml-title-draft-asyncapi'
    default:
      return 'zenuml-title-draft'
  }
}

export interface TitleDraftRecord {
  state: 'added'
  contentId: string
  source: 'title-draft'
  at: number
}

/** The record could not be read. Callers must fail closed (make no offer). */
export interface TitleDraftUnknown {
  unknown: true
}

export type TitleDraftRead = TitleDraftRecord | null | TitleDraftUnknown

export type TitleDraftWrite = 'written' | 'deleted' | 'unchanged' | 'forbidden' | 'failed'

export function isUnknownRead(read: TitleDraftRead): read is TitleDraftUnknown {
  return !!read && (read as TitleDraftUnknown).unknown === true
}

const propertiesPath = (pageId: string) => `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/properties`

function parseRecord(raw: unknown): TitleDraftRecord | null {
  const v = raw as Partial<TitleDraftRecord> | undefined
  if (!v || v.state !== 'added' || typeof v.contentId !== 'string' || !v.contentId) return null
  if (v.source !== 'title-draft' || typeof v.at !== 'number') return null
  return { state: 'added', contentId: v.contentId, source: 'title-draft', at: v.at }
}

type RawRead =
  | { status: 'ok'; record: TitleDraftRecord; propertyId: string; version: number }
  | { status: 'absent' }
  | { status: 'error' }

async function readRaw(pageId: string): Promise<RawRead> {
  try {
    const res = await request(`${propertiesPath(pageId)}?key=${encodeURIComponent(TITLE_DRAFT_PROPERTY_KEY)}`, 'GET')
    if (!res.ok) return { status: 'error' }
    const body = await res.json()
    const first = body?.results?.[0]
    if (!first) return { status: 'absent' }
    const record = parseRecord(first.value)
    if (!record) return { status: 'error' }
    return { status: 'ok', record, propertyId: String(first.id), version: Number(first.version?.number) || 1 }
  } catch (e) {
    console.debug('[title-draft] record read failed', e)
    return { status: 'error' }
  }
}

/** null = genuinely absent; `{unknown:true}` = could not tell. Never throws. */
export async function readTitleDraftRecord(pageId: string): Promise<TitleDraftRead> {
  const read = await readRaw(pageId)
  if (read.status === 'ok') return read.record
  if (read.status === 'absent') return null
  return { unknown: true }
}

const outcome = (res: { ok: boolean; status: number }, success: TitleDraftWrite): TitleDraftWrite =>
  res.status === 403 ? 'forbidden' : res.ok ? success : 'failed'

export async function writeAddedRecord(
  pageId: string,
  contentId: string,
  now: number = Date.now(),
): Promise<TitleDraftWrite> {
  try {
    const current = await readRaw(pageId)
    if (current.status === 'error') return 'failed'
    const value: TitleDraftRecord = { state: 'added', contentId: String(contentId), source: 'title-draft', at: now }
    if (current.status === 'absent') {
      return outcome(await request(propertiesPath(pageId), 'POST', { key: TITLE_DRAFT_PROPERTY_KEY, value }), 'written')
    }
    return outcome(
      await request(`${propertiesPath(pageId)}/${encodeURIComponent(current.propertyId)}`, 'PUT', {
        key: TITLE_DRAFT_PROPERTY_KEY,
        version: { number: current.version + 1 },
        value,
      }),
      'written',
    )
  } catch (e) {
    console.debug('[title-draft] record write failed', e)
    return 'failed'
  }
}

export async function deleteTitleDraftRecord(pageId: string): Promise<TitleDraftWrite> {
  try {
    const current = await readRaw(pageId)
    if (current.status === 'absent') return 'unchanged'
    if (current.status === 'error') return 'failed'
    const res = await request(`${propertiesPath(pageId)}/${encodeURIComponent(current.propertyId)}`, 'DELETE')
    if (res.status === 403) return 'forbidden'
    // 404 means it is already gone, which is the state we want.
    return res.ok || res.status === 404 ? 'deleted' : 'failed'
  } catch (e) {
    console.debug('[title-draft] record delete failed', e)
    return 'failed'
  }
}
