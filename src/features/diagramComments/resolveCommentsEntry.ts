import { reactive } from 'vue'
import { isDiagramCommentsEnabled } from '@/apis/aiTitleFeatureFlag'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { viewerAccountKind } from '@/utils/magic/viewerAccount'
import type { CommentsEntryConfig } from './commentsEntry'

type ForgeLikeContext = Record<string, any>

/**
 * The static half of the Comments entry's availability (#1047), taken from the
 * Forge context where the edge host is installed: page, page url, macro and
 * viewer. The flag and the viewer kind are filled in by resolveCommentsEntry;
 * what the viewer learns after loading comes through commentsContextStore.
 */
export function createCommentsEntry(forgeContext: ForgeLikeContext): CommentsEntryConfig {
  const pageId = forgeContext?.extension?.content?.id ?? forgeContext?.contentId
  const pageUrl = forgeContext?.extension?.location ?? (window as any).initialContext?.currentPageUrl ?? ''
  return reactive<CommentsEntryConfig>({
    enabled: false,
    pageId: pageId ? String(pageId) : '',
    pageUrl: typeof pageUrl === 'string' ? pageUrl : '',
    localId: forgeContext?.localId || undefined,
    accountId: forgeContext?.accountId || undefined,
  })
}

/** Reads the flag, then (only when on) classifies the viewer. Never throws; a failure leaves the entry off or `unknown`. */
export async function resolveCommentsEntry(
  entry: CommentsEntryConfig,
  deps: {
    isEnabled?: () => Promise<boolean>
    viewerKind?: typeof viewerAccountKind
  } = {},
): Promise<void> {
  let enabled = false
  try {
    enabled = await (deps.isEnabled ?? isDiagramCommentsEnabled)()
  } catch {
    enabled = false
  }
  if (!enabled) return
  // Anonymous viewers have no account id: the host shows them no entry at all.
  if (entry.accountId) {
    try {
      const kind = await (deps.viewerKind ?? viewerAccountKind)({ accountId: entry.accountId, clientDomain: getClientDomain() })
      entry.viewerKind = kind === 'guest' || kind === 'licensed' ? kind : 'unknown'
    } catch {
      entry.viewerKind = 'unknown'
    }
  }
  // Last: the entry appears only once its facts are in, so no re-render flicker on the label.
  entry.enabled = true
}
