import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReviewRun } from '@zenuml/pr-panel-shared'
import { ReviewStore } from './review-store'
import { PR, PR2, REPO_KEY, tempDir } from './test-helpers'

function run(overrides: Partial<ReviewRun>): ReviewRun {
  return {
    runId: 'r1',
    repoKey: REPO_KEY,
    pr: PR,
    reviewedHeadSha: 'aaaaaaa1',
    status: 'completed',
    headline: 'Looks fine',
    summary: 'Summary',
    findings: [],
    tags: [],
    prState: 'open',
    startedAt: 100,
    completedAt: 200,
    agentKind: 'claude_code',
    ...overrides,
  }
}

describe('ReviewStore', () => {
  it('writes atomically and reloads from disk', () => {
    const dir = tempDir()
    const store = new ReviewStore(dir)
    store.upsert(run({}))
    store.upsert(run({ runId: 'r2', completedAt: 300, headline: 'Second' }))
    const file = store.fileFor(REPO_KEY)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    // No temp files left behind.
    expect(readdirSync(join(dir, 'reviews')).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(2)

    const reopened = new ReviewStore(dir)
    expect(reopened.history(REPO_KEY).map((r) => r.runId)).toEqual(['r2', 'r1'])
  })

  it('upsert replaces by runId', () => {
    const store = new ReviewStore(tempDir())
    store.upsert(run({}))
    store.upsert(run({ headline: 'Changed' }))
    store.clearCache()
    const runs = store.history(REPO_KEY)
    expect(runs).toHaveLength(1)
    expect(runs[0].headline).toBe('Changed')
  })

  it('lists the latest completed run per PR, newest first, and marks stale rows', () => {
    const store = new ReviewStore(tempDir())
    store.upsert(run({ runId: 'old', completedAt: 200, reviewedHeadSha: '1111111' }))
    store.upsert(run({ runId: 'new', completedAt: 400, reviewedHeadSha: 'aaaaaaa1' }))
    store.upsert(run({ runId: 'failed', completedAt: 900, status: 'failed' }))
    store.upsert(run({ runId: 'pr8', pr: PR2, completedAt: 300, reviewedHeadSha: 'bbbbbbb2', mergeable: false }))

    const rows = store.listLatestCompleted(REPO_KEY, new Map([[7, 'aaaaaaa1ffff'], [8, 'ccccccc3']]))
    expect(rows.map((r) => r.runId)).toEqual(['new', 'pr8'])
    expect(rows[0].stale).toBe(false)
    expect(rows[1].stale).toBe(true)
    expect(rows[1].conflict).toBe(true)
    expect(rows[0].url).toBe('https://github.com/Acme/Widgets/pull/7')

    // Unknown head: never stale.
    expect(store.listLatestCompleted(REPO_KEY).every((r) => !r.stale)).toBe(true)
    expect(store.history(REPO_KEY, 8).map((r) => r.runId)).toEqual(['pr8'])
  })
})
