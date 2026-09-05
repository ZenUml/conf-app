import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  addDiagramToPage,
  buildMacroNode,
  referencesCustomContent,
  reloadHostPage,
  resolveIdentity,
} from './addToPage'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'

const requestConfluence = vi.hoisted(() => vi.fn())
const routerReload = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ requestConfluence, router: { reload: routerReload } }))

const APP = '8ad26115-211f-4216-971b-0540f606303d'
const ENV = 'de60a8cb-4c03-48e5-bdb7-63226e9394c4'
// The real shape, captured from the live byline iframe on 2026-09-05.
const LOCAL_ID = `ari-cloud-ecosystem--extension-${APP}-${ENV}-static-zenuml-byline-diagrams`
const DIAGRAM = { id: '713064451', diagramType: DiagramType.Sequence }

const res = (status: number, body?: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})
const pageWith = (content: unknown[], version = 3) =>
  res(200, {
    id: 'page-1',
    title: 'Test page',
    version: { number: version },
    body: { atlas_doc_format: { value: JSON.stringify({ version: 1, type: 'doc', content }) } },
  })
const macroNode = (ccId: string) => ({
  type: 'extension',
  attrs: { parameters: { guestParams: { customContentId: ccId } } },
})
const put = () => requestConfluence.mock.calls.find(([, o]) => o?.method === 'PUT')

describe('addToPage — placing a diagram without the four-step detour', () => {
  beforeEach(() => {
    requestConfluence.mockReset()
    ;(forgeGlobal as any).forgeContext = { localId: LOCAL_ID, environmentId: ENV }
  })

  describe('identity', () => {
    it('pulls appId and environmentId out of the flattened ARI', () => {
      expect(resolveIdentity({ localId: LOCAL_ID, environmentId: ENV })).toEqual({
        appId: APP,
        environmentId: ENV,
      })
    })

    it('REFUSES when localId and environmentId disagree', () => {
      // A malformed extensionKey renders as an unknown extension on a
      // customer's page (lite-full-conversion.ts, job c5a6d954). Writing
      // nothing is strictly better.
      expect(resolveIdentity({ localId: LOCAL_ID, environmentId: 'something-else' })).toBeNull()
    })

    it('refuses an unrecognised localId shape', () => {
      expect(resolveIdentity({ localId: 'ari:cloud:ecosystem::extension/whatever' })).toBeNull()
      expect(resolveIdentity({})).toBeNull()
      expect(resolveIdentity(undefined)).toBeNull()
    })
  })

  describe('the node it writes', () => {
    it('matches the shape Confluence itself writes', () => {
      const node: any = buildMacroNode({ appId: APP, environmentId: ENV }, 'zenuml-sequence-macro-lite', '99')
      expect(node.type).toBe('extension')
      expect(node.attrs.extensionType).toBe('com.atlassian.ecosystem')
      expect(node.attrs.extensionKey).toBe(`${APP}/${ENV}/static/zenuml-sequence-macro-lite`)
      expect(node.attrs.parameters.extensionId).toBe(
        `ari:cloud:ecosystem::extension/${APP}/${ENV}/static/zenuml-sequence-macro-lite`,
      )
      expect(node.attrs.parameters.guestParams.customContentId).toBe('99')
      expect(node.attrs.localId).toBeTruthy()
    })

    it('gives every insertion its own localId — that is macro identity', () => {
      const a: any = buildMacroNode({ appId: APP, environmentId: ENV }, 'k', '1')
      const b: any = buildMacroNode({ appId: APP, environmentId: ENV }, 'k', '1')
      expect(a.attrs.localId).not.toBe(b.attrs.localId)
    })
  })

  describe('detecting what the page already has', () => {
    it('finds a reference under guestParams, macroParams, or the top level', () => {
      expect(referencesCustomContent({ content: [macroNode('7')] }, '7')).toBe(true)
      expect(
        referencesCustomContent(
          { content: [{ attrs: { parameters: { macroParams: { customContentId: { value: '7' } } } } }] },
          '7',
        ),
      ).toBe(true)
      expect(referencesCustomContent({ content: [macroNode('8')] }, '7')).toBe(false)
    })
  })

  describe('writing', () => {
    it('appends the macro and publishes the next version', async () => {
      requestConfluence
        .mockResolvedValueOnce(pageWith([{ type: 'paragraph' }], 3))
        .mockResolvedValueOnce(res(200, {}))

      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({ result: 'added' })

      const body = JSON.parse(put()![1].body)
      expect(body.version.number).toBe(4)
      const adf = JSON.parse(body.body.value)
      expect(adf.content).toHaveLength(2)
      // Appended, never rewriting what was there: nothing here knows where the
      // author wanted it.
      expect(adf.content[0]).toEqual({ type: 'paragraph' })
      expect(adf.content[1].attrs.parameters.guestParams.customContentId).toBe(DIAGRAM.id)
    })

    it('writes nothing when the page already renders the diagram', async () => {
      requestConfluence.mockResolvedValueOnce(pageWith([macroNode(DIAGRAM.id)]))

      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({
        result: 'already_present',
        pageMacroCount: 1,
      })
      expect(put()).toBeUndefined()
    })

    it('reports a reader who cannot edit, rather than pretending', async () => {
      requestConfluence.mockResolvedValueOnce(pageWith([])).mockResolvedValueOnce(res(403))
      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({ result: 'forbidden' })
    })

    it('re-reads once on a conflict, then gives up rather than forcing', async () => {
      // The version we would overwrite is somebody's edit.
      requestConfluence
        .mockResolvedValueOnce(pageWith([], 3))
        .mockResolvedValueOnce(res(409))
        .mockResolvedValueOnce(pageWith([], 7))
        .mockResolvedValueOnce(res(409))

      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({ result: 'conflict' })
      expect(requestConfluence.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(2)
    })

    it('succeeds on the retry when the conflict clears', async () => {
      requestConfluence
        .mockResolvedValueOnce(pageWith([], 3))
        .mockResolvedValueOnce(res(409))
        .mockResolvedValueOnce(pageWith([], 7))
        .mockResolvedValueOnce(res(200, {}))

      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({ result: 'added' })
      expect(JSON.parse(put()![1].body).version.number).toBe(4)
    })

    it('refuses to write at all when it cannot trust the identity', async () => {
      ;(forgeGlobal as any).forgeContext = { localId: 'nonsense' }
      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({ result: 'failed' })
      expect(requestConfluence).not.toHaveBeenCalled()
    })

    it('refuses a diagram type no macro renders', async () => {
      expect(await addDiagramToPage('page-1', { id: '1', diagramType: 'nonsense' })).toMatchObject({
        result: 'failed',
      })
      expect(requestConfluence).not.toHaveBeenCalled()
    })

    it('never throws when the bridge rejects', async () => {
      requestConfluence.mockRejectedValue(new Error('bridge down'))
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await addDiagramToPage('page-1', DIAGRAM)).toMatchObject({ result: 'failed' })
      error.mockRestore()
    })
  })
})

describe('reloadHostPage', () => {
  it('reloads the Confluence page the iframe sits in', async () => {
    routerReload.mockResolvedValue(undefined)
    await expect(reloadHostPage()).resolves.toBe(true)
    expect(routerReload).toHaveBeenCalled()
  })

  it('reports failure instead of throwing on an operation that succeeded', async () => {
    // The diagram IS on the page by the time this runs. A refused reload leaves
    // the page as it was — the pre-existing behaviour — and must never surface
    // as an error about the add.
    routerReload.mockRejectedValue(new Error('no bridge'))
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    await expect(reloadHostPage()).resolves.toBe(false)
    debug.mockRestore()
  })
})
