import { describe, expect, it } from 'vitest'
import type { PrRef, ReviewGroup } from '@zenuml/pr-panel-shared'
import { completedItemForPage, shouldShowReviewList, type CompletionFeedback } from './review-group-page'

const first: PrRef = { host: 'github.com', owner: 'example-owner', repo: 'example-repo', number: 7 }
const second: PrRef = { ...first, number: 8 }
const group: ReviewGroup = {
  groupId: 'round-1', product: 'Example', requestedCount: 2, status: 'ready', createdAt: 1, updatedAt: 2,
  items: [
    { pr: first, decisionTitle: 'Review first', ci: 'success', materialHeadSha: 'aaaaaaa', materialUpdatedAt: 1, outcome: 'pending' },
    { pr: second, decisionTitle: 'Review second', ci: 'pending', materialHeadSha: 'bbbbbbb', materialUpdatedAt: 1, outcome: 'pending' },
  ],
}

describe('review group page visibility', () => {
  it('keeps a just-completed native item visible with the next pending item, then hides it on other pages', () => {
    expect(shouldShowReviewList(group, first, null)).toBe(true)
    const completed: ReviewGroup = { ...group, items: [{ ...group.items[0]!, outcome: 'merged' }, group.items[1]!] }
    const feedback: CompletionFeedback = { groupId: group.groupId, pr: first, outcome: 'merged', autoAdvance: true }
    expect(shouldShowReviewList(completed, first, null)).toBe(false) // external result has no completion feedback
    expect(shouldShowReviewList(completed, first, feedback)).toBe(true)
    expect(completedItemForPage(completed, first, feedback)?.outcome).toBe('merged')
    expect(shouldShowReviewList(completed, { ...first, number: 99 }, feedback)).toBe(false)
    expect(shouldShowReviewList({ ...completed, groupId: 'round-2' }, first, feedback)).toBe(false)
  })

  it('keeps the final completed item visible only for its own native feedback', () => {
    const done: ReviewGroup = { ...group, status: 'completed', items: group.items.map((item) => ({ ...item, outcome: 'closed' })) }
    expect(shouldShowReviewList(done, second, { groupId: group.groupId, pr: second, outcome: 'closed', autoAdvance: false })).toBe(true)
    expect(shouldShowReviewList(done, second, null)).toBe(false)
  })
})
