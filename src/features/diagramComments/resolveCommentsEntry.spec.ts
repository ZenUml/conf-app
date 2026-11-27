import { describe, expect, it, vi } from 'vitest'
import { createCommentsEntry, resolveCommentsEntry } from './resolveCommentsEntry'

vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isDiagramCommentsEnabled: vi.fn(async () => false) }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({ getClientDomain: () => 'example-tenant' }))
vi.mock('@/utils/magic/viewerAccount', () => ({ viewerAccountKind: vi.fn(async () => 'licensed') }))

const forgeContext = {
  accountId: 'acc-me', localId: 'loc-1',
  extension: { type: 'confluence:macro', content: { id: '42' }, location: 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout?x=1' },
}

describe('createCommentsEntry', () => {
  it('takes page, page url, macro and viewer from the Forge context, with the entry off', () => {
    expect(createCommentsEntry(forgeContext)).toMatchObject({
      enabled: false, pageId: '42', localId: 'loc-1', accountId: 'acc-me',
      pageUrl: 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout?x=1',
    })
  })
  it('has no account id for an anonymous viewer and no page id when the context carries none', () => {
    const entry = createCommentsEntry({ extension: {} })
    expect(entry.accountId).toBeUndefined()
    expect(entry.pageId).toBe('')
  })
})

describe('resolveCommentsEntry', () => {
  it('stays off and never looks the viewer up while the flag is off', async () => {
    const viewerKind = vi.fn()
    const entry = createCommentsEntry(forgeContext)
    await resolveCommentsEntry(entry, { isEnabled: async () => false, viewerKind })
    expect(entry.enabled).toBe(false)
    expect(viewerKind).not.toHaveBeenCalled()
  })
  it('turns on with the viewer kind when the flag is on', async () => {
    const entry = createCommentsEntry(forgeContext)
    await resolveCommentsEntry(entry, { isEnabled: async () => true, viewerKind: async () => 'guest' })
    expect(entry).toMatchObject({ enabled: true, viewerKind: 'guest' })
  })
  it('keeps the entry for guests: a failed or odd lookup is unknown, never a block', async () => {
    const failing = createCommentsEntry(forgeContext)
    await resolveCommentsEntry(failing, { isEnabled: async () => true, viewerKind: async () => { throw new Error('x') } })
    expect(failing).toMatchObject({ enabled: true, viewerKind: 'unknown' })
    const anon = createCommentsEntry(forgeContext)
    await resolveCommentsEntry(anon, { isEnabled: async () => true, viewerKind: async () => 'anonymous' })
    expect(anon.viewerKind).toBe('unknown')
  })
  it('leaves an anonymous viewer without a lookup (the host hides the entry on the missing account id)', async () => {
    const viewerKind = vi.fn()
    const entry = createCommentsEntry({ extension: { content: { id: '42' } } })
    await resolveCommentsEntry(entry, { isEnabled: async () => true, viewerKind })
    expect(viewerKind).not.toHaveBeenCalled()
    expect(entry.accountId).toBeUndefined()
  })
  it('a flag lookup that throws leaves the entry off', async () => {
    const entry = createCommentsEntry(forgeContext)
    await resolveCommentsEntry(entry, { isEnabled: async () => { throw new Error('flag') } })
    expect(entry.enabled).toBe(false)
  })
})
