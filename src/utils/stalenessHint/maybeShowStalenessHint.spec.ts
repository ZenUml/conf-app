import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./flags', () => ({ isStalenessHintEnabled: vi.fn() }))
vi.mock('./drift', () => ({ getDrift: vi.fn() }))
vi.mock('./hint', () => ({ mountStalenessHint: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { isStalenessHintEnabled } from './flags'
import { getDrift } from './drift'
import { mountStalenessHint } from './hint'
import { writeDismissMarker } from './core'
import { maybeShowStalenessHint } from './maybeShowStalenessHint'

const inlineCtx = {
  accountId: 'user-1',
  extension: {
    type: 'macro',
    isEditing: true,
    content: { id: 'page-1', version: 7 },
  },
}

const input = (over: Record<string, unknown> = {}) => ({
  context: inlineCtx,
  macroType: 'sequence',
  ccId: 'cc-1',
  ccLastModified: '2026-07-01T00:00:00Z',
  ccAuthorId: 'author-9',
  onCta: vi.fn(),
  ...over,
})

describe('maybeShowStalenessHint gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
    vi.mocked(isStalenessHintEnabled).mockResolvedValue(true)
    vi.mocked(getDrift).mockResolvedValue(9)
  })

  it('mounts when all gates pass (non-author)', async () => {
    await maybeShowStalenessHint(input())
    expect(mountStalenessHint).toHaveBeenCalledWith(
      expect.objectContaining({ drift: 9, isDiagramAuthor: false, macroType: 'sequence', ccId: 'cc-1' })
    )
  })

  it('detects the diagram author', async () => {
    await maybeShowStalenessHint(input({ ccAuthorId: 'user-1' }))
    expect(mountStalenessHint).toHaveBeenCalledWith(expect.objectContaining({ isDiagramAuthor: true }))
  })

  it('skips: not inline editor surface', async () => {
    await maybeShowStalenessHint(input({ context: { ...inlineCtx, extension: { ...inlineCtx.extension, isEditing: false } } }))
    expect(getDrift).not.toHaveBeenCalled()
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: out-of-scope macro type', async () => {
    await maybeShowStalenessHint(input({ macroType: 'embed' }))
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: flag off (and never fetches drift)', async () => {
    vi.mocked(isStalenessHintEnabled).mockResolvedValue(false)
    await maybeShowStalenessHint(input())
    expect(getDrift).not.toHaveBeenCalled()
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: drift below threshold', async () => {
    vi.mocked(getDrift).mockResolvedValue(4)
    await maybeShowStalenessHint(input())
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('skips: active dismissal', async () => {
    writeDismissMarker('cc-1')
    await maybeShowStalenessHint(input())
    expect(mountStalenessHint).not.toHaveBeenCalled()
  })

  it('never throws on internal failure', async () => {
    vi.mocked(isStalenessHintEnabled).mockRejectedValue(new Error('boom'))
    await expect(maybeShowStalenessHint(input())).resolves.toBeUndefined()
  })
})
