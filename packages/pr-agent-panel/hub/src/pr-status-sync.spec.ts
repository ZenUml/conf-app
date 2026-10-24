import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewRun } from '@zenuml/pr-panel-shared'
import { readSavedPrStatuses } from './github-pr-reader'
import { PrStatusStore } from './pr-status-store'
import { PrStatusSync } from './pr-status-sync'
import { ReviewStore } from './review-store'
import { HubRuntime } from './runtime'
import { PR, PR2, REPO_KEY, connectExtension, frame, tempDir } from './test-helpers'

function run(pr = PR, runId = `r${pr.number}`): ReviewRun {
  return {
    runId, repoKey: REPO_KEY, pr, reviewedHeadSha: pr.headSha ?? 'aaaaaaa1',
    status: 'completed', headline: 'Reviewed', summary: 'Earlier verdict', findings: [], tags: [],
    prState: 'open', startedAt: 100, completedAt: 200, agentKind: 'codex',
  }
}

describe('saved PR status refresh', () => {
  it('reads only saved identities in GraphQL batches and maps draft, closed, merged, and reopened', async () => {
    const refs = [PR, PR2, { ...PR, number: 9 }, { ...PR, number: 10 }]
    const queries: string[] = []
    const result = await readSavedPrStatuses(refs, async (query) => {
      queries.push(query)
      return { data: { repository: {
        p0: { state: 'OPEN', isDraft: true, headRefOid: 'aaaaaaa1' },
        p1: { state: 'CLOSED', isDraft: false, headRefOid: 'bbbbbbb2' },
        p2: { state: 'MERGED', isDraft: false, headRefOid: 'ccccccc3' },
        p3: { state: 'OPEN', isDraft: false, headRefOid: 'ddddddd4' },
      } } }
    })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('pullRequest(number: 7)')
    expect(queries[0]).not.toContain('pullRequests(')
    expect(result.failed).toBe(0)
    expect(result.observations.map((item) => item.observed.state)).toEqual(['draft', 'closed', 'merged', 'open'])
  })

  it('preserves status on partial and total GitHub failures', async () => {
    const partial = await readSavedPrStatuses([PR, PR2], async () => ({ data: { repository: {
      p0: { state: 'MERGED', isDraft: false, headRefOid: 'bbbbbbb2' }, p1: null,
    } } }))
    expect(partial.observations).toHaveLength(1)
    expect(partial.failed).toBe(1)
    const failed = await readSavedPrStatuses([PR], async () => { throw new Error('rate limited') })
    expect(failed).toEqual({ observations: [], failed: 1 })
  })

  it('persists current observations separately, overlays unopened rows, broadcasts, and ignores a stale tab head', async () => {
    const dir = tempDir()
    const reviews = new ReviewStore(dir)
    const statuses = new PrStatusStore(dir)
    reviews.upsert(run())
    reviews.upsert(run(PR2))
    const runtime = new HubRuntime({ store: reviews, statuses })
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd7', pr: PR }))
    const sync = new PrStatusSync({
      reviews, statuses, onChanged: (repo) => runtime.refreshReviews(repo),
      read: async () => ({ observations: [
        { ref: PR, observed: { state: 'merged', headSha: 'ccccccc3' } },
        { ref: PR2, observed: { state: 'draft', headSha: 'ddddddd4' } },
      ], failed: 0 }),
    })
    await sync.refresh()
    const rows = conn.last('reviews')?.items ?? []
    expect(rows.map((row) => row.prState)).toEqual(['merged', 'draft'])
    expect(rows.map((row) => row.stale)).toEqual([true, true])
    expect(conn.of('reviews')).toHaveLength(1) // one broadcast for this repository
    expect(new PrStatusStore(dir).get(REPO_KEY, 7)).toEqual({ state: 'merged', headSha: 'ccccccc3' })
    expect(statSync(join(dir, 'pr-status.json')).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(join(dir, 'pr-status.json'), 'utf8'))[`${REPO_KEY}#7`].state).toBe('merged')
    expect(reviews.history(REPO_KEY, 7)[0].prState).toBe('open') // historical result remains intact

    const failedSync = new PrStatusSync({ reviews, statuses, onChanged: vi.fn(), read: async () => { throw new Error('offline') } })
    await failedSync.refresh()
    expect(statuses.get(REPO_KEY, 7)?.state).toBe('merged')
    expect(conn.of('reviews')).toHaveLength(1)
  })

  it('does not recreate a deleted PR when an in-flight query returns', async () => {
    const dir = tempDir()
    const reviews = new ReviewStore(dir)
    const statuses = new PrStatusStore(dir)
    reviews.upsert(run())
    let answer!: (value: Awaited<ReturnType<typeof readSavedPrStatuses>>) => void
    const read = vi.fn(() => new Promise<Awaited<ReturnType<typeof readSavedPrStatuses>>>((resolve) => { answer = resolve }))
    const sync = new PrStatusSync({ reviews, statuses, onChanged: vi.fn(), read })
    const pending = sync.refresh()
    expect(read).toHaveBeenCalledOnce()
    reviews.deleteForPr(REPO_KEY, 7)
    answer({ observations: [{ ref: PR, observed: { state: 'closed' } }], failed: 0 })
    await pending
    expect(statuses.get(REPO_KEY, 7)).toBeUndefined()
    expect(reviews.listReviewedPrRefs()).toEqual([])
  })
})
