import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PrRef } from '@zenuml/pr-panel-shared'
import { ReviewGroupStore } from './review-group-store'
import type { RemotePr, ReviewGateway } from './github-review-gateway'
import { PR, REPO, connectExtension, frame, makeRuntime, tempDir } from './test-helpers'

const PR8: PrRef = { ...PR, number: 8, headSha: 'bbbbbbb2' }
const item = (pr: PrRef) => ({ pr, decisionTitle: `Decide PR ${pr.number}`, ci: 'pending' as const,
  materialHeadSha: pr.headSha!, materialsMarkdown: '## Problem and value\nEvidence\n## Before / After\nChanged\n## Verified\nCheck passed\n## Unverified\nNone\n## Risks and decision\nReview' })

function gateway(): ReviewGateway & { states: Map<number, RemotePr>; writes: number[] } {
  const states = new Map<number, RemotePr>([
    [7, { state: 'open', headSha: 'aaaaaaa1', body: 'Original seven' }],
    [8, { state: 'open', headSha: 'bbbbbbb2', body: 'Original eight' }],
  ])
  const writes: number[] = []
  return {
    states, writes,
    read: async (pr) => states.get(pr.number)!,
    readCi: async () => 'success',
    writeMaterials: async (pr, head, _markdown, current) => {
      if (!current()) throw new Error('superseded')
      if (states.get(pr.number)?.headSha !== head) throw new Error('head changed')
      writes.push(pr.number)
    },
  }
}

describe('finite review group', () => {
  it('publishes a finite group, persists it, and clears it on a zero result', async () => {
    const dir = tempDir()
    const groupStore = new ReviewGroupStore(join(dir, 'store'))
    const gh = gateway()
    const { runtime } = makeRuntime({ groupStore, reviewGateway: gh })
    const conn = connectExtension(runtime)
    const first = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 2 })
    expect(conn.last('group')?.preparation?.requestId).toBe(first.requestId)
    const published = await runtime.publishReviewGroup({ requestId: first.requestId, items: [item(PR), item(PR8)] })
    expect(published.group.items).toHaveLength(2)
    expect(gh.writes).toEqual([7, 8])
    expect(new ReviewGroupStore(join(dir, 'store')).get()?.groupId).toBe(first.requestId)
    const zero = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 0 })
    expect(zero.previousGroup?.groupId).toBe(first.requestId)
    await runtime.publishReviewGroup({ requestId: zero.requestId, items: [] })
    expect(runtime.getReviewGroup().group?.status).toBe('zero')
    expect(conn.last('group')?.group?.items).toEqual([])
  })

  it('keeps the previous group on preparation failure and rejects a superseded request', async () => {
    const gh = gateway()
    const { runtime } = makeRuntime({ reviewGateway: gh })
    const first = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 1 })
    await runtime.publishReviewGroup({ requestId: first.requestId, items: [item(PR)] })
    const failed = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 1 })
    runtime.failReviewGroup({ requestId: failed.requestId, reason: 'Candidate query unavailable' })
    expect(runtime.getReviewGroup().group?.groupId).toBe(first.requestId)
    expect(runtime.getReviewGroup().preparation?.error).toContain('unavailable')
    const latest = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 1 })
    await expect(runtime.publishReviewGroup({ requestId: failed.requestId, items: [item(PR8)] })).rejects.toThrow('no longer current')
    expect(gh.writes).toEqual([7])
    expect(runtime.getReviewGroup().preparation?.requestId).toBe(latest.requestId)
  })

  it('confirms a bound AI result once and leaves an unconfirmed action pending', async () => {
    const gh = gateway()
    const { runtime } = makeRuntime({ reviewGateway: gh })
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'owned', pr: PR }))
    const request = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 2 })
    await runtime.publishReviewGroup({ requestId: request.requestId, items: [item(PR), item(PR8)] })
    const binding = runtime.bindReviewAction({ groupId: request.requestId, repo: REPO, prNumber: 7, expectedHeadSha: 'aaaaaaa1', action: 'merge' })
    expect(await runtime.confirmReviewAction(binding.actionId)).toEqual({ confirmed: false })
    expect(runtime.getReviewGroup().group?.items[0].outcome).toBe('pending')
    gh.states.set(7, { state: 'merged', headSha: 'aaaaaaa1', body: 'Original seven' })
    expect(await runtime.confirmReviewAction(binding.actionId)).toEqual({ confirmed: true, outcome: 'merged' })
    expect(conn.last('reviewItemResult')).toMatchObject({ source: 'ai', documentId: 'owned', outcome: 'merged' })
    await expect(runtime.confirmReviewAction(binding.actionId)).rejects.toThrow('Unknown action')
    expect(runtime.getReviewGroup().group?.items[1].outcome).toBe('pending')
  })

  it('marks external completion without a navigation target and refreshes only CI', async () => {
    const gh = gateway()
    const { runtime } = makeRuntime({ reviewGateway: gh })
    const conn = connectExtension(runtime)
    const request = runtime.startReviewGroup({ product: 'Widgets', requestedCount: 2 })
    await runtime.publishReviewGroup({ requestId: request.requestId, items: [item(PR), item(PR8)] })
    gh.states.set(7, { state: 'closed', headSha: 'aaaaaaa1', body: 'Original seven' })
    await runtime.refreshGroupFacts()
    expect(conn.last('reviewItemResult')).toMatchObject({ source: 'external', outcome: 'closed' })
    expect(conn.last('reviewItemResult')).not.toHaveProperty('documentId')
    expect(runtime.getReviewGroup().group?.items[1]).toMatchObject({ ci: 'success', outcome: 'pending' })
    expect(gh.writes).toEqual([7, 8])
  })
})
