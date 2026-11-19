import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addTitleDraftToPage, pageHasOwnMacro } from './insertAtTop'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'

const requestConfluence = vi.hoisted(() => vi.fn())
const readRecord = vi.hoisted(() => vi.fn())
const writeRecord = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ requestConfluence }))
vi.mock('./pageState', () => ({ readTitleDraftRecord: readRecord, writeAddedRecord: writeRecord }))

const APP = '8ad26115-211f-4216-971b-0540f606303d'
const ENV = 'de60a8cb-4c03-48e5-bdb7-63226e9394c4'
const LOCAL_ID = `ari-cloud-ecosystem--extension-${APP}-${ENV}-static-zenuml-byline-diagrams`
const DIAGRAM = { id: '9001', diagramType: DiagramType.Sequence }

const res = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const pageWith = (content: unknown[], version = 3) =>
  res(200, {
    id: 'page-1',
    title: 'Checkout retry design',
    version: { number: version },
    body: { atlas_doc_format: { value: JSON.stringify({ version: 1, type: 'doc', content }) } },
  })
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const ownMacro = (key = 'zenuml-sequence-macro') => ({
  type: 'extension',
  attrs: { extensionKey: `${APP}/${ENV}/static/${key}`, parameters: { guestParams: { customContentId: '1' } } },
})
const otherAppMacro = { type: 'extension', attrs: { extensionKey: 'ffffffff-0000-0000-0000-000000000000/e/static/x' } }
const puts = () => requestConfluence.mock.calls.filter(([, o]) => o?.method === 'PUT')
const written = () => JSON.parse(JSON.parse(puts()[0][1].body).body.value)

describe('addTitleDraftToPage', () => {
  beforeEach(() => {
    requestConfluence.mockReset()
    readRecord.mockReset().mockResolvedValue(null)
    writeRecord.mockReset().mockResolvedValue('written')
    ;(forgeGlobal as any).forgeContext = { localId: LOCAL_ID, environmentId: ENV }
  })

  it('inserts at index 0 and keeps existing content in order', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([para('a'), para('b')])).mockResolvedValueOnce(res(200, {}))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toEqual({ result: 'added' })
    const doc = written()
    expect(doc.content).toHaveLength(3)
    expect(doc.content[0].type).toBe('extension')
    expect(doc.content[0].attrs.parameters.guestParams.customContentId).toBe('9001')
    expect(doc.content.slice(1)).toEqual([para('a'), para('b')])
    const body = JSON.parse(puts()[0][1].body)
    expect(body.version).toEqual({ number: 4, message: 'Added a ZenUML diagram from the page title' })
    expect(writeRecord).toHaveBeenCalledWith('page-1', '9001')
  })

  it('still reports added when the record write fails', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([])).mockResolvedValueOnce(res(200, {}))
    writeRecord.mockRejectedValueOnce(new Error('boom'))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toEqual({ result: 'added' })
  })

  it('returns already_added with no PUT when a record exists', async () => {
    readRecord.mockResolvedValue({ state: 'added', contentId: '1', source: 'title-draft', at: 1 })
    requestConfluence.mockResolvedValueOnce(pageWith([]))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toEqual({ result: 'already_added' })
    expect(puts()).toHaveLength(0)
  })

  it('returns already_added when the page already has a ZenUML macro', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([para('a'), ownMacro('zenuml-graph-macro')]))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toEqual({ result: 'already_added' })
    expect(puts()).toHaveLength(0)
  })

  it('ignores extensions from other apps', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([otherAppMacro])).mockResolvedValueOnce(res(200, {}))
    expect((await addTitleDraftToPage('page-1', DIAGRAM)).result).toBe('added')
  })

  it('on 409 re-reads; if the winner is now on the page, gives already_added without a second PUT', async () => {
    requestConfluence
      .mockResolvedValueOnce(pageWith([para('a')], 3))
      .mockResolvedValueOnce(res(409))
      .mockResolvedValueOnce(pageWith([ownMacro(), para('a')], 4))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toEqual({ result: 'already_added' })
    expect(puts()).toHaveLength(1)
  })

  it('on 409 with no winner retries once and succeeds', async () => {
    requestConfluence
      .mockResolvedValueOnce(pageWith([para('a')], 3))
      .mockResolvedValueOnce(res(409))
      .mockResolvedValueOnce(pageWith([para('a'), para('c')], 4))
      .mockResolvedValueOnce(res(200, {}))
    expect((await addTitleDraftToPage('page-1', DIAGRAM)).result).toBe('added')
    expect(puts()).toHaveLength(2)
  })

  it('gives conflict after two 409s', async () => {
    requestConfluence
      .mockResolvedValueOnce(pageWith([], 3))
      .mockResolvedValueOnce(res(409))
      .mockResolvedValueOnce(pageWith([], 4))
      .mockResolvedValueOnce(res(409))
    expect((await addTitleDraftToPage('page-1', DIAGRAM)).result).toBe('conflict')
    expect(puts()).toHaveLength(2)
    expect(writeRecord).not.toHaveBeenCalled()
  })

  it('maps 403 on read and write to forbidden', async () => {
    requestConfluence.mockResolvedValueOnce(res(403))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toMatchObject({ result: 'forbidden', status: 403 })
    requestConfluence.mockResolvedValueOnce(pageWith([])).mockResolvedValueOnce(res(403))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toMatchObject({ result: 'forbidden', reason: 'write_forbidden' })
  })

  it('fails when identity or macro key cannot be resolved', async () => {
    ;(forgeGlobal as any).forgeContext = { localId: 'junk', environmentId: ENV }
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toMatchObject({ result: 'failed', reason: 'unresolved_macro_key' })
    ;(forgeGlobal as any).forgeContext = { localId: LOCAL_ID, environmentId: ENV }
    expect(await addTitleDraftToPage('page-1', { id: '1', diagramType: 'nonsense' })).toMatchObject({ result: 'failed' })
    expect(requestConfluence).not.toHaveBeenCalled()
  })

  it('fails on other write errors and on throws', async () => {
    requestConfluence.mockResolvedValueOnce(pageWith([])).mockResolvedValueOnce(res(500))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toMatchObject({ result: 'failed', status: 500 })
    requestConfluence.mockRejectedValueOnce(new Error('boom'))
    expect(await addTitleDraftToPage('page-1', DIAGRAM)).toMatchObject({ result: 'failed', reason: 'threw' })
  })
})

describe('pageHasOwnMacro', () => {
  it('finds nested extension nodes from this app only', () => {
    const doc = { type: 'doc', content: [{ type: 'panel', content: [ownMacro()] }] }
    expect(pageHasOwnMacro(doc, APP)).toBe(true)
    expect(pageHasOwnMacro({ content: [otherAppMacro] }, APP)).toBe(false)
    expect(pageHasOwnMacro({ content: [para('x')] }, APP)).toBe(false)
  })
})
