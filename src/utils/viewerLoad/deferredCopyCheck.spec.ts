import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
// @ts-expect-error — src/shims-vue.d.ts re-exports @vue/runtime-dom, which
// doesn't surface reactivity-only symbols like watch/nextTick (project-wide
// gap; see the matching @ts-expect-error on deferredCopyCheck.ts's `toRaw`
// import — same shim limitation, unrelated files).
import { watch, nextTick } from 'vue'
import { runDeferredCopyCheck } from './deferredCopyCheck'
import store from '@/model/store2'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { getRenderIdentity } from '@/utils/analytics/renderIdentity'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

vi.mock('@/utils/analytics/renderIdentity', () => ({
  getRenderIdentity: vi.fn(() => ({
    instance_nonce: '11111111-1111-4111-8111-111111111111',
    time_origin: 123456,
  })),
}))

function makeDoc(): any {
  return { copyCheckPending: true }
}

describe('runDeferredCopyCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRenderIdentity).mockReturnValue({
      instance_nonce: '11111111-1111-4111-8111-111111111111',
      time_origin: 123456,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('writes verdict onto the store diagram when it is the mounted doc', async () => {
    const doc = makeDoc()
    store.state.diagram = doc
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(350)
    vi.mocked(trackAnalyticsEvent).mockImplementation(() => {
      expect(store.state.diagram.copyCheckPending).toBe(false)
    })
    const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: true, copyReason: 'same-page-duplicate' }) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1', 'mermaid')
    expect(store.state.diagram.isCopy).toBe(true)
    expect(store.state.diagram.copyReason).toBe('same-page-duplicate')
    expect(store.state.diagram.copyCheckPending).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledOnce()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_adf_scan_completed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      result: 'succeeded',
      adf_deferred: true,
      page_adf_fetch_ms: 250,
      copy_detected: true,
      copy_reason: 'same-page-duplicate',
      writeback_target: 'store',
      instance_nonce: '11111111-1111-4111-8111-111111111111',
      time_origin: 123456,
    })
  })

  it('clears pending without setting isCopy when detectCopy rejects', async () => {
    const doc = makeDoc()
    store.state.diagram = doc
    vi.spyOn(performance, 'now').mockReturnValueOnce(500).mockReturnValueOnce(620)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ap = { detectCopy: vi.fn().mockRejectedValue(new Error('sensitive network detail')) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1', 'sequence')
    expect(store.state.diagram.isCopy).toBeUndefined()
    expect(store.state.diagram.copyCheckPending).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledOnce()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_adf_scan_completed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'sequence',
      result: 'failed',
      failure_reason: 'detect_copy_failed',
      adf_deferred: true,
      page_adf_fetch_ms: 120,
      writeback_target: 'store',
      instance_nonce: '11111111-1111-4111-8111-111111111111',
      time_origin: 123456,
    })
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('sensitive network detail')
  })

  it('writes the raw doc when the store holds a different diagram', async () => {
    const doc = makeDoc()
    store.state.diagram = { other: true } as any
    const ap = { detectCopy: vi.fn().mockResolvedValue({ isCopy: false }) }
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1', 'plantuml')
    expect(doc.isCopy).toBe(false)
    expect(doc.copyCheckPending).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'viewer_adf_scan_completed',
      expect.objectContaining({
        macro_type: 'plantuml',
        result: 'succeeded',
        copy_detected: false,
        writeback_target: 'raw',
      }),
    )
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
    await runDeferredCopyCheck(ap as any, doc, 'cc-1', 'page-1', 'mermaid')
    await nextTick()
    expect(spy).toHaveBeenCalledWith(true, undefined, expect.anything())
    stop()
  })
})
