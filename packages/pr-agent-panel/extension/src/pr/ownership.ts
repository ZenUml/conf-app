import type { ReviewSummary } from '@zenuml/pr-panel-shared'

/** Ownership is explicit current GitHub author or assignee metadata. Unknown metadata never grants visibility. */
export function isOwnedByViewer(item: ReviewSummary, viewerLogin: string | null): boolean {
  if (!viewerLogin) return false
  const viewer = viewerLogin.toLowerCase()
  return item.authorLogin?.toLowerCase() === viewer
    || (item.assigneeLogins ?? []).some((login) => login.toLowerCase() === viewer)
}

export function visibleReviewsForViewer(items: ReviewSummary[], viewerLogin: string | null): ReviewSummary[] {
  return items.filter((item) => isOwnedByViewer(item, viewerLogin))
}
