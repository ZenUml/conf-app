import type { ReviewSummary } from '@zenuml/pr-panel-shared'

/** Only the current GitHub author grants visibility. Unknown metadata never grants visibility. */
export function isOwnedByViewer(item: ReviewSummary, viewerLogin: string | null): boolean {
  if (!viewerLogin) return false
  return item.authorLogin?.toLowerCase() === viewerLogin.toLowerCase()
}

export function visibleReviewsForViewer(items: ReviewSummary[], viewerLogin: string | null): ReviewSummary[] {
  return items.filter((item) => isOwnedByViewer(item, viewerLogin))
}
