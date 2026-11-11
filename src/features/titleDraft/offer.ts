import forgeGlobal, { openModal } from '@/model/globals/forgeGlobal'
import globals from '@/model/globals'
import { isTitleDraftEnabled } from '@/apis/aiTitleFeatureFlag'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { resolveIdentity, reloadHostPage } from '@/utils/byline/addToPage'
import { requestConfluenceJson } from '@/utils/byline/confluenceRequest'
import { viewerAccountKind } from '@/utils/magic/viewerAccount'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { callRemote } from '@/utils/requestUtil'
import { canEditPage } from './canEdit'
import { TITLE_DRAFT_MACRO_MODE, type TitleDraftClosePayload } from './constants'
import { pageHasOwnMacro } from './insertAtTop'
import {
  canShowEntryFlag,
  consumeFirstNotNow,
  deriveTitleDraftIdentity,
  isLookupFresh,
  isNotNow,
  markEntryFlagShown,
  markNotNow,
  PENDING_RECHECK_MS,
  recordLookup,
  takeJustAdded,
  writeJustAdded,
  type TitleDraftIdentity,
} from './localState'
import { titleDraftProps } from './offerProps'
import { readTitleDraftRecord } from './pageState'
import { undoTitleDraft } from './undo'

interface Draft {
  pageId: string
  pageTitle: string
  mermaid: string
  kind?: string
  confidence?: number
}

/**
 * The page banner's title-first offer: at most one diagram, drafted from the
 * page title, for someone who can edit a page that has no diagram.
 *
 * Returns true when it took over the banner iframe. The flag's buttons run in
 * this iframe, so it stays open at zero height until the page is left (measured
 * on lite-stg, 2026-11-08). Every check below fails closed: no offer.
 *
 * The checks run cheapest first, because this runs on page views that end with
 * nothing to show. The backend is asked last and only for people who could act.
 */
export async function maybeOfferTitleDraft(productType: string | undefined): Promise<boolean> {
  try {
    // The rollout flag exists only on the Lite app.
    if (productType !== 'lite' || !(await isTitleDraftEnabled())) return false
    await globals.apWrapper.initializeContext()
    const identity = deriveTitleDraftIdentity()
    const content = forgeGlobal.forgeContext?.extension?.content
    if (!identity || !content?.id || (content.type && content.type !== 'page')) return false
    const pageId = String(content.id)

    const justAdded = takeJustAdded(identity, pageId)
    if (justAdded) {
      collapseFrame()
      await showAddedFlag(identity, pageId, justAdded.contentId)
      return true
    }

    const draft = await findDraft(identity, pageId)
    if (!draft) return false
    collapseFrame()
    await showEntryFlag(identity, draft)
    return true
  } catch (e) {
    console.debug('[title-draft] offer skipped', e)
    return false
  }
}

async function findDraft(identity: TitleDraftIdentity, pageId: string): Promise<Draft | null> {
  if (isNotNow(identity, pageId) || isLookupFresh(identity, pageId) || !canShowEntryFlag(identity)) return null
  const kind = await viewerAccountKind({ accountId: identity.accountId, clientDomain: getClientDomain() || 'unknown' })
  if (kind !== 'licensed') return null

  const read = await requestConfluenceJson(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=atlas_doc_format`, 'GET')
  if (!read.ok) return null
  const page = await read.json()
  const raw = page?.body?.atlas_doc_format?.value
  const pageTitle = typeof page?.title === 'string' ? page.title.trim() : ''
  const app = resolveIdentity(forgeGlobal.forgeContext as any)
  if (!raw || !pageTitle || !app) return null
  // Remembered for a day, so this page stops costing these reads on every view.
  if (pageHasOwnMacro(JSON.parse(raw), app.appId) || (await readTitleDraftRecord(pageId)) !== null) {
    recordLookup(identity, pageId)
    return null
  }
  if (!(await canEditPage(pageId, identity.accountId))) {
    recordLookup(identity, pageId)
    return null
  }

  const result = await callRemote('/api/title-draft', 'POST', {
    pageId,
    title: pageTitle,
    spaceName: await spaceName(page?.spaceId),
  })
  const status = result?.status
  if (status === 'pending' || status === 'ready' || status === 'no_diagram') {
    trackAnalyticsEvent('title_draft_requested', { ...titleDraftProps(), title_draft_status: status })
  }
  if (status !== 'ready' || typeof result?.mermaid !== 'string' || !result.mermaid) {
    if (status === 'pending') recordLookup(identity, pageId, Date.now(), PENDING_RECHECK_MS)
    else recordLookup(identity, pageId)
    return null
  }
  return { pageId, pageTitle, mermaid: result.mermaid, kind: result.kind, confidence: result.confidence }
}

async function spaceName(spaceId: unknown): Promise<string | undefined> {
  if (!spaceId) return undefined
  try {
    const response = await requestConfluenceJson(`/wiki/api/v2/spaces/${encodeURIComponent(String(spaceId))}`, 'GET')
    if (!response.ok) return undefined
    const space = await response.json()
    return typeof space?.name === 'string' ? space.name.slice(0, 255) : undefined
  } catch {
    return undefined
  }
}

/** The banner slot shows nothing: the offer is a flag, and the slot must not reserve a strip. */
function collapseFrame(): void {
  document.getElementById('app')?.replaceChildren()
  document.documentElement.style.height = '0'
  document.body.style.cssText = 'margin:0;height:0;min-height:0;overflow:hidden'
}

async function bridgeFlag() {
  const { showFlag } = await import('@forge/bridge')
  return showFlag
}

async function showEntryFlag(identity: TitleDraftIdentity, draft: Draft): Promise<void> {
  const showFlag = await bridgeFlag()
  const props = titleDraftProps(draft.kind, draft.confidence)
  const flag = showFlag({
    id: `title-draft-offer-${draft.pageId}`,
    title: 'A diagram for this page is ready',
    description: 'ZenUML sketched it from the page title. Nothing changes until you add it.',
    type: 'info',
    isAutoDismiss: false,
    actions: [
      {
        text: 'See diagram',
        onClick: () => {
          void flag.close()
          void openPreview(identity, draft)
        },
      },
      {
        text: 'Not now',
        onClick: () => {
          void flag.close()
          markNotNow(identity, draft.pageId)
          trackAnalyticsEvent('title_draft_not_now', props)
          if (consumeFirstNotNow(identity)) void showNotNowFlag(draft.pageId)
        },
      },
    ],
  })
  markEntryFlagShown(identity)
  trackAnalyticsEvent('title_draft_flag_shown', props)
}

async function showNotNowFlag(pageId: string): Promise<void> {
  const showFlag = await bridgeFlag()
  showFlag({
    id: `title-draft-not-now-${pageId}`,
    title: 'No more diagram suggestions on this page',
    description: 'To add one later, open Diagrams Lite under the page title.',
    type: 'success',
    isAutoDismiss: true,
  })
}

async function openPreview(identity: TitleDraftIdentity, draft: Draft): Promise<void> {
  const props = titleDraftProps(draft.kind, draft.confidence)
  let closed = false
  trackAnalyticsEvent('title_draft_preview_opened', props)
  await openModal({
    resource: 'main',
    size: 'xlarge',
    title: `Diagram for ${draft.pageTitle}`,
    closeOnEscape: true,
    closeOnOverlayClick: true,
    context: {
      macroMode: TITLE_DRAFT_MACRO_MODE,
      pageId: draft.pageId,
      pageTitle: draft.pageTitle,
      mermaid: draft.mermaid,
      kind: draft.kind,
      confidence: draft.confidence,
    },
    onClose: (payload?: TitleDraftClosePayload) => {
      if (closed) return
      closed = true
      if (payload?.outcome === 'added') {
        writeJustAdded(identity, { pageId: draft.pageId, contentId: payload.contentId, at: Date.now() })
        void reloadHostPage()
        return
      }
      if (payload?.outcome === 'already_added') {
        recordLookup(identity, draft.pageId)
        void showAlreadyAddedFlag(draft.pageId)
        return
      }
      trackAnalyticsEvent('title_draft_preview_closed', {
        ...props,
        surface: 'modal',
        page_id: draft.pageId,
        title_draft_close_reason: payload?.outcome === 'dismissed' ? payload.reason ?? 'unknown' : 'host_dismissed',
      })
    },
  })
}

async function showAlreadyAddedFlag(pageId: string): Promise<void> {
  const showFlag = await bridgeFlag()
  const flag = showFlag({
    id: `title-draft-already-${pageId}`,
    title: 'A diagram was already added to this page',
    description: 'Reload the page to see it.',
    type: 'info',
    isAutoDismiss: false,
    actions: [{ text: 'Reload', onClick: () => { void flag.close(); void reloadHostPage() } }],
  })
}

async function showAddedFlag(identity: TitleDraftIdentity, pageId: string, contentId: string): Promise<void> {
  const showFlag = await bridgeFlag()
  const props = titleDraftProps()
  const flag = showFlag({
    id: `title-draft-added-${pageId}`,
    title: 'Added to the top of the page',
    description: 'To move it, edit the page, then drag the handle to its left.',
    type: 'success',
    isAutoDismiss: false,
    actions: [
      {
        text: 'Edit diagram',
        onClick: () => {
          void flag.close()
          trackAnalyticsEvent('title_draft_edit_clicked', props)
          void openModal({
            resource: 'main',
            size: 'fullscreen',
            context: { macroMode: 'editor', diagramType: 'sequence', customContentId: contentId },
            onClose: () => { void reloadHostPage() },
          })
        },
      },
      {
        text: 'Undo',
        onClick: () => {
          void flag.close()
          void undo(identity, pageId, contentId)
        },
      },
    ],
  })
}

async function undo(identity: TitleDraftIdentity, pageId: string, contentId: string): Promise<void> {
  const props = titleDraftProps()
  const { result } = await undoTitleDraft(pageId, contentId)
  if (result === 'undone' || result === 'not_found') {
    markNotNow(identity, pageId)
    trackAnalyticsEvent('title_draft_undone', props)
    await reloadHostPage()
    return
  }
  trackAnalyticsEvent('title_draft_undo_failed', props)
  const showFlag = await bridgeFlag()
  showFlag({
    id: `title-draft-undo-failed-${pageId}`,
    title: 'The diagram was not removed',
    description: 'To remove it, edit the page and delete the diagram.',
    type: 'error',
    isAutoDismiss: false,
  })
}
