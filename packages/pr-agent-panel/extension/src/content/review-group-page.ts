import { repoKeyOf, type PrRef, type ReviewGroup, type ReviewGroupItem } from '@zenuml/pr-panel-shared'

export interface CompletionFeedback {
  groupId: string
  pr: PrRef
  outcome: 'merged' | 'closed'
  autoAdvance: boolean
}

/** A completed item remains on its own page only while native completion feedback is active. */
export function completedItemForPage(group: ReviewGroup | null, pr: PrRef | null, feedback: CompletionFeedback | null): ReviewGroupItem | null {
  if (!group || !pr || !feedback || group.groupId !== feedback.groupId) return null
  if (repoKeyOf(pr) !== repoKeyOf(feedback.pr) || pr.number !== feedback.pr.number) return null
  return group.items.find((item) => repoKeyOf(item.pr) === repoKeyOf(pr) && item.pr.number === pr.number && item.outcome === feedback.outcome) ?? null
}

export function shouldShowReviewList(group: ReviewGroup | null, pr: PrRef | null, feedback: CompletionFeedback | null): boolean {
  if (!group || !pr) return false
  return group.items.some((item) => repoKeyOf(item.pr) === repoKeyOf(pr) && item.pr.number === pr.number && item.outcome === 'pending')
    || completedItemForPage(group, pr, feedback) !== null
}
