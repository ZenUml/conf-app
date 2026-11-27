import type { DiagramCommentViewerKind } from '@/utils/analytics/catalog'

/**
 * What the edge host needs to offer Comments (#1047). A reactive object: the flag
 * and the viewer kind resolve after the host is installed. Everything the viewer
 * only learns after its content loads lives in commentsContextStore instead.
 */
export interface CommentsEntryConfig {
  /** The `diagram-comments-enabled` flag is on. */
  enabled: boolean
  pageId: string
  pageUrl: string
  localId?: string
  /** The viewer's account id. Absent for anonymous viewers, who get no entry. */
  accountId?: string
  /** Resolved asynchronously; `unknown` until it answers. Never blocks the entry. */
  viewerKind?: DiagramCommentViewerKind
  /** Root-thread count for this diagram. Overridable for tests; defaults to the page-comment cache. */
  loadCount?: (pageId: string, diagramId: string) => Promise<number>
  /** Host-page navigation for the "Reply in Confluence" fallback. Defaults to the Forge router. */
  navigate?: (path: string) => Promise<unknown> | unknown
}
