import { describe, it, expect, vi } from 'vitest'
import { runDeferredCopyCheck } from './deferredCopyCheck'
import store from '@/model/store2'

function makeDoc(): any {
  return { copyCheckPending: true }
}

describe('runDeferredCopyCheck', () => {
  it('writes verdict onto the store diagram when it is the mounted doc', async () => {
    const doc = makeDoc()
    store.state.diagram = doc
    const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: true, copyReason: 'same-page-duplicate' }) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1')
    expect(store.state.diagram.isCopy).toBe(true)
    expect(store.state.diagram.copyReason).toBe('same-page-duplicate')
    expect(store.state.diagram.copyCheckPending).toBe(false)
  })

  it('clears pending without setting isCopy when detectCopy rejects', async () => {
    const doc = makeDoc()
    store.state.diagram = doc
    const ap = { detectCopy: vi.fn().mockRejectedValue(new Error('network')) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1')
    expect(store.state.diagram.isCopy).toBeUndefined()
    expect(store.state.diagram.copyCheckPending).toBe(false)
  })

  it('writes the raw doc when the store holds a different diagram', async () => {
    const doc = makeDoc()
    store.state.diagram = { other: true } as any
    const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: false }) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1')
    expect(doc.isCopy).toBe(false)
    expect(doc.copyCheckPending).toBe(false)
  })
})
