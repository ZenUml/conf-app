import { describe, expect, it } from 'vitest'
import type { ReviewSummary } from '@zenuml/pr-panel-shared'
import { isOwnedByViewer, visibleReviewsForViewer } from './ownership'

const row = (n: number, metadata: Partial<ReviewSummary> = {}): ReviewSummary => ({
  runId: `r${n}`, repoKey: 'github.com/example/repo', prNumber: n,
  url: `https://github.com/example/repo/pull/${n}`,
  headline: `PR ${n}`, summary: '', tags: [], prState: 'open', conflict: false, stale: false, completedAt: n,
  ...metadata,
})

describe('My PRs scope', () => {
  it('accepts current author or Assignee, case insensitively', () => {
    expect(isOwnedByViewer(row(1, { authorLogin: 'MrCoder' }), 'mrcoder')).toBe(true)
    expect(isOwnedByViewer(row(2, { authorLogin: 'Other', assigneeLogins: ['MRCODER'] }), 'MrCoder')).toBe(true)
  })

  it('excludes unrelated, missing metadata, and missing GitHub identity', () => {
    const mixed = [
      row(1, { authorLogin: 'MrCoder' }),
      row(2, { authorLogin: 'Other', assigneeLogins: ['MrCoder'] }),
      row(3, { authorLogin: 'Other', assigneeLogins: ['SomeoneElse'] }),
      row(4),
    ]
    expect(visibleReviewsForViewer(mixed, 'MrCoder').map((item) => item.prNumber)).toEqual([1, 2])
    expect(visibleReviewsForViewer(mixed, null)).toEqual([])
  })
})
