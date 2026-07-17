import { describe, it, expect, vi } from 'vitest'
// @ts-expect-error — src/shims-vue.d.ts re-exports @vue/runtime-dom, which
// doesn't surface reactivity-only symbols like watch/nextTick (project-wide
// gap; see the matching @ts-expect-error on deferredCopyCheck.ts's `toRaw`
// import — same shim limitation, unrelated files).
import { watch, nextTick } from 'vue'
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

  it('writes through the store proxy so a reactive watcher on the mounted doc fires', async () => {
    const doc = makeDoc()
    store.state.diagram = doc
    const spy = vi.fn()
    // Registering the watcher AFTER `store.state.diagram = doc` and reading
    // through `store.state.diagram` (not the raw `doc`) means this only
    // fires if runDeferredCopyCheck writes onto the reactive proxy. A write
    // that lands on the raw `doc` instead (bypassing the store) mutates the
    // same underlying data — so a plain read of store.state.diagram.isCopy
    // would still observe `true` — but never notifies Vue's reactivity
    // system, so this watcher would never fire and the spy stays uncalled.
    const stop = watch(() => store.state.diagram.isCopy, spy)
    const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: true, copyReason: 'same-page-duplicate' }) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1')
    await nextTick()
    expect(spy).toHaveBeenCalledWith(true, undefined, expect.anything())
    stop()
  })
})
