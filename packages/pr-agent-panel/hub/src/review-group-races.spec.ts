import { describe, expect, it, vi } from 'vitest'
import type { RemotePr, ReviewGateway } from './github-review-gateway'
import { PR, REPO, connectExtension, frame, makeRuntime } from './test-helpers'

const selection = (text: string) => ({ pr: PR, decisionTitle: text, ci: 'success' as const, materialHeadSha: PR.headSha!, materialsMarkdown: text })
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve }); return { promise, release } }
function fixture() {
  let remote: RemotePr = { state: 'open', headSha: PR.headSha!, body: 'original' }
  const gh: ReviewGateway = {
    read: async () => ({ ...remote }),
    writeMaterials: async (_pr, _head, text, current) => { if (!current()) throw new Error('superseded'); remote.body = text },
  }
  return { gh, get: () => remote, set: (next: Partial<RemotePr>) => { remote = { ...remote, ...next } } }
}

describe('review group races', () => {
  it('serializes writes to the same PR across superseding requests', async () => {
    const f = fixture(); const { runtime } = makeRuntime({ reviewGateway: f.gh }); const entered = gate(); const finish = gate()
    f.gh.writeMaterials = async (_pr, _head, text, current) => {
      if (!current()) throw new Error('superseded')
      if (text === 'old focus') { entered.release(); await finish.promise }
      f.set({ body: text })
    }
    const a = runtime.startReviewGroup({ product: 'A', requestedCount: 1 })
    const old = runtime.publishReviewGroup({ requestId: a.requestId, items: [selection('old focus')] }).catch((error: Error) => error.message)
    await entered.promise
    const b = runtime.startReviewGroup({ product: 'B', requestedCount: 1 })
    const newer = runtime.publishReviewGroup({ requestId: b.requestId, items: [selection('new focus')] })
    finish.release()
    expect(await old).toContain('newer review request')
    await newer
    expect(runtime.getReviewGroup().group?.groupId).toBe(b.requestId)
    expect(f.get().body).toBe('new focus')
  })

  it('keeps a completed item completed when its material refresh returns', async () => {
    const f = fixture(); const { runtime } = makeRuntime({ reviewGateway: f.gh })
    const a = runtime.startReviewGroup({ product: 'A', requestedCount: 1 })
    await runtime.publishReviewGroup({ requestId: a.requestId, items: [selection('initial')] })
    const entered = gate(); const finish = gate()
    f.gh.writeMaterials = async (_pr, _head, _text, current) => { expect(current()).toBe(true); entered.release(); await finish.promise }
    const refresh = runtime.refreshReviewMaterial({ groupId: a.requestId, repo: REPO, prNumber: PR.number, expectedHeadSha: PR.headSha!, materialsMarkdown: 'refresh', ci: 'success' })
    await entered.promise
    f.set({ state: 'merged' }); await runtime.refreshGroupFacts()
    finish.release()
    expect((await refresh).item.outcome).toBe('merged')
    expect(runtime.getReviewGroup().group?.status).toBe('completed')
  })

  it('replays native feedback after a poll confirms the same merge', async () => {
    const f = fixture(); const { runtime } = makeRuntime({ reviewGateway: f.gh }); const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'origin', pr: PR }))
    const a = runtime.startReviewGroup({ product: 'A', requestedCount: 1 })
    await runtime.publishReviewGroup({ requestId: a.requestId, items: [selection('initial')] })
    f.set({ state: 'merged' }); await runtime.refreshGroupFacts()
    runtime.handleExtensionFrame(conn.id, frame('nativeResultHint', { documentId: 'origin', groupId: a.requestId, pr: PR, action: 'merge' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(conn.of('reviewItemResult').map((x) => x.source)).toEqual(['external', 'native'])
    runtime.handleExtensionFrame(conn.id, frame('nativeResultHint', { documentId: 'origin', groupId: a.requestId, pr: PR, action: 'merge' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(conn.of('reviewItemResult').map((x) => x.source)).toEqual(['external', 'native'])
  })

  it('still replays native feedback for a tab after the agent confirmed the same merge', async () => {
    const f = fixture(); const { runtime } = makeRuntime({ reviewGateway: f.gh }); const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'origin', pr: PR }))
    const a = runtime.startReviewGroup({ product: 'A', requestedCount: 1 })
    await runtime.publishReviewGroup({ requestId: a.requestId, items: [selection('initial')] })
    const binding = runtime.bindReviewAction({ groupId: a.requestId, repo: REPO, prNumber: PR.number, expectedHeadSha: PR.headSha!, action: 'merge' })
    expect(binding.documentId).toBe('origin')
    f.set({ state: 'merged' })
    expect(await runtime.confirmReviewAction(binding.actionId)).toEqual({ confirmed: true, outcome: 'merged' })
    runtime.handleExtensionFrame(conn.id, frame('nativeResultHint', { documentId: 'origin', groupId: a.requestId, pr: PR, action: 'merge' }))
    await vi.waitFor(() => expect(conn.of('reviewItemResult').map((x) => x.source)).toEqual(['ai', 'native']), { timeout: 1500 })
  })

  it('retries a native result while GitHub briefly still reports open', async () => {
    const f = fixture(); const { runtime } = makeRuntime({ reviewGateway: f.gh }); const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'origin', pr: PR }))
    const a = runtime.startReviewGroup({ product: 'A', requestedCount: 1 })
    await runtime.publishReviewGroup({ requestId: a.requestId, items: [selection('initial')] })
    const baseRead = f.gh.read
    let reads = 0
    f.gh.read = async (pr) => {
      reads += 1
      return reads === 1 ? { state: 'open', headSha: PR.headSha!, body: 'initial' } : baseRead(pr)
    }
    f.set({ state: 'merged' })
    runtime.handleExtensionFrame(conn.id, frame('nativeResultHint', { documentId: 'origin', groupId: a.requestId, pr: PR, action: 'merge' }))
    await vi.waitFor(() => expect(conn.of('reviewItemResult').map((x) => x.source)).toEqual(['native']), { timeout: 1500 })
    expect(reads).toBe(2)
    expect(runtime.getReviewGroup().group?.status).toBe('completed')
  })
})
