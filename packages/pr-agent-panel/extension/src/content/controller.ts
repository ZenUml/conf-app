/** Wires the request-scoped review list to one GitHub tab and its broker port. */
import { createApp, h, type App } from 'vue'
import { repoKeyOf, type PrRef, type ReviewGroupItem } from '@zenuml/pr-panel-shared'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createShadowRootUi, type ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root'
import { buildTelemetryFrame, messageLengthBucket, type TelemetryEvent, type TelemetryProps } from '../analytics/telemetry'
import { PanelPort, documentId, envelope } from '../bridge/port'
import { containWheel, installContentShift, listColumnTop } from '../pr/page-column'
import { parsePrRef, parseRepoRef, readPrState, readViewerLogin } from '../pr/identity'
import { getPrefs, onPrefsChanged, setPref } from '../state/prefs'
import AgentPanel from '../ui/AgentPanel.vue'
import ReviewGroupList from '../ui/ReviewGroupList.vue'
import { createPageStore } from './store'

export function createPageController(ctx: ContentScriptContext) {
  const store = createPageStore(documentId)
  const { state } = store
  let port: PanelPort | null = null
  let panelUi: ShadowRootContentScriptUi<App> | null = null
  let listUi: ShadowRootContentScriptUi<App> | null = null
  let undoContentShift: (() => void) | null = null
  let undoContainWheel: (() => void) | null = null
  let placeQueued = false
  let listShownSent = false
  let observer: MutationObserver | null = null
  let observedFrame: Element | null = null
  let ensureQueued = false
  let nativeAction: 'merge' | 'close' | null = null
  let resultHintSent = false
  let nextTimer: ReturnType<typeof setTimeout> | null = null
  let resultNotice: HTMLElement | null = null
  let materialNotice: HTMLElement | null = null

  function telemetry(event: TelemetryEvent, props: TelemetryProps = {}) {
    try {
      port?.send(buildTelemetryFrame(event, props))
    } catch {
      // A schema rejection is a bug in this file; never let it break the page.
    }
  }

  function registerCurrent() {
    if (!port) return
    if (state.pr) {
      port.send(envelope({ type: 'register' as const, documentId, pr: state.pr }))
      port.send(envelope({ type: 'listReviews' as const, repoKey: repoKeyOf(state.pr), currentHeadSha: state.pr.headSha }))
      port.send(envelope({ type: 'listGroup' as const }))
    }
  }

  function readPage(href = location.href): { pr: PrRef | null; changed: boolean } {
    state.viewerLogin = readViewerLogin(document)
    // Before the URL commits the document still shows the previous page: take only what the URL gives,
    // and leave title, head and state to refreshPageDetails once GitHub renders the new PR.
    const committed = href === location.href
    const pr = parsePrRef(href, committed ? document : undefined)
    const repo = pr ?? parseRepoRef(href)
    const prev = state.pr
    const changed = (prev?.number ?? null) !== (pr?.number ?? null) || (prev && pr ? repoKeyOf(prev) !== repoKeyOf(pr) : false)
    state.pr = pr
    state.prState = pr && committed ? readPrState(document) : 'unknown'
    const repoKey = repo ? repoKeyOf(repo) : null
    if (repoKey !== state.repoKey) {
      state.repoKey = repoKey
      state.reviews = []
      state.reviewsLoaded = false
    }
    return { pr, changed }
  }

  // The legacy panel is retained for compatibility but is not mounted in this flow.
  async function mountPanel() {
    if (ctx.isInvalid) return
    panelUi = await createOrphanSafeUi<App>({
      name: 'zenuml-pr-panel',
      position: 'overlay',
      anchor: 'body',
      append: 'last',
      inheritStyles: true, // panel.css carries its own `:host(zenuml-pr-panel) { all: initial }`
      isolateEvents: true, // keep GitHub's keyboard shortcuts out of the message box
      onMount(container) {
        const app = createApp({
          render: () =>
            h(AgentPanel, {
              connection: store.connection.value,
              task: store.task.value,
              pr: state.pr,
              prState: state.prState,
              review: store.review.value,
              messages: state.messages,
              prefs: state.prefs,
              onActivate: () => port?.send(envelope({ type: 'activate' as const, documentId })),
              onStop: (taskId: string) => {
                const frame = envelope({ type: 'cancelTask' as const, taskId })
                if (port?.send(frame)) store.noteCancel(frame.id, taskId)
              },
              onDone: (taskId: string) => store.dismissTask(taskId),
              onSend: (text: string) => {
                const frame = envelope({ type: 'userMessage' as const, documentId, taskId: store.task.value?.taskId, text })
                if (port?.send(frame)) {
                  store.addUserMessage(frame.id, text)
                  telemetry('pr_panel_message_sent', { message_length_bucket: messageLengthBucket(text.length) })
                }
              },
              onToggleCollapsed: () => {
                const collapsed = !state.prefs.panelCollapsed
                state.prefs.panelCollapsed = collapsed
                void setPref('panelCollapsed', collapsed)
                telemetry('pr_panel_panel_toggled', { panel_state: collapsed ? 'collapsed' : 'expanded' })
              },
              onTogglePrefs: () => {
                const hidden = !state.prefs.preferencesHidden
                state.prefs.preferencesHidden = hidden
                void setPref('preferencesHidden', hidden)
                telemetry('pr_panel_preferences_changed', { preference_key: 'preferences_hidden' })
              },
              onSetMcpAccess: (value: 'enabled' | 'disabled') => {
                port?.post({ kind: 'setMcpAccess', value })
                telemetry('pr_panel_preferences_changed', { preference_key: 'mcp_access' })
              },
              onOpenOptions: () => port?.post({ kind: 'openOptions' }),
              onResize: (width: number) => void setPref('panelWidth', width),
              onMove: (position: { right: number; bottom: number }) => void setPref('panelPosition', position),
            }),
        })
        app.mount(container)
        return app
      },
      onRemove(app) {
        app?.unmount()
      },
    })
    panelUi?.mount()
  }

  // ---------------------------------------------------------------- list
  /**
   * After the extension reloads, the old content script keeps running in open tabs until it notices.
   * Its runtime calls then throw "Extension context invalidated"; treat that as teardown, not an error.
   */
  async function createOrphanSafeUi<T>(options: Parameters<typeof createShadowRootUi<T>>[1]) {
    try {
      return await createShadowRootUi<T>(ctx, options)
    } catch (error) {
      if (ctx.isInvalid) return null
      throw error
    }
  }

  async function mountList() {
    removeList()
    if (!state.pr || !store.currentGroupItem.value || !state.group || ctx.isInvalid) return
    const ui = await createOrphanSafeUi<App>({
      name: 'zenuml-pr-list',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      inheritStyles: true, // list.css carries its own `:host(zenuml-pr-list)` reset and sizing
      isolateEvents: true,
      onMount(container, _shadow, host) {
        // Page-level column under the repository tabs (Figma 184:5402); see page-column.ts.
        host.style.top = `${listColumnTop(document)}px`
        const app = createApp({
          render: () =>
            h(ReviewGroupList, {
              group: state.group!,
              preparation: state.preparation,
              currentPrNumber: state.pr?.number ?? 0,
              offline: state.status.state !== 'connected',
              onOpen: (item: ReviewGroupItem) => {
                location.assign(item.pr.url ?? `https://${item.pr.host}/${item.pr.owner}/${item.pr.repo}/pull/${item.pr.number}`)
              },
            }),
        })
        app.mount(container)
        return app
      },
      onRemove(app) {
        app?.unmount()
      },
    })
    if (!ui || !store.currentGroupItem.value) return
    removeList()
    listUi = ui
    ui.mount()
    undoContentShift = installContentShift(document)
    undoContainWheel = containWheel(ui.shadowHost)
    window.addEventListener('scroll', queuePlaceList, { passive: true })
    window.addEventListener('resize', queuePlaceList, { passive: true })
    listShownSent = false
    maybeSendListShown()
    updateMaterialNotice()
  }

  function removeList() {
    listUi?.remove()
    listUi = null
    undoContentShift?.()
    undoContentShift = null
    undoContainWheel?.()
    undoContainWheel = null
    window.removeEventListener('scroll', queuePlaceList)
    window.removeEventListener('resize', queuePlaceList)
  }

  /** Keeps the column's top edge on the bottom of the repository tabs as the page scrolls. */
  function queuePlaceList() {
    if (placeQueued) return
    placeQueued = true
    requestAnimationFrame(() => {
      placeQueued = false
      const host = listUi?.shadowHost
      if (host) host.style.top = `${listColumnTop(document)}px`
    })
  }

  function maybeSendListShown() {
    if (listShownSent || !listUi || !state.group) return
    listShownSent = true
    telemetry('pr_panel_review_list_shown', { review_count: store.pendingGroupItems.value.length })
  }

  function updateMaterialNotice() {
    materialNotice?.remove()
    materialNotice = null
    const item = store.currentGroupItem.value
    if (!item) return
    const body = document.querySelector<HTMLElement>('.comment-body, [data-testid="issue-body"]')
    if (!body?.parentElement) return
    const note = document.createElement('div')
    note.id = 'zenuml-review-material-notice'
    note.style.cssText = 'padding:10px 14px;margin:0 0 12px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;color:#1f2328;font:12px system-ui,sans-serif'
    const current = state.pr?.headSha
    const stale = current && current.toLowerCase() !== item.materialHeadSha.toLowerCase()
    note.textContent = stale ? 'Review material is stale: this PR head changed. Ask the agent to refresh the evidence.'
      : current ? `Review material verified at ${item.materialHeadSha.slice(0, 8)}.`
        : 'Review material head is unconfirmed. Verify the current PR head before deciding.'
    body.parentElement.insertBefore(note, body)
    materialNotice = note
    if (stale) telemetry('pr_panel_material_stale_shown', { is_stale: true })
  }

  /**
   * On soft navigation the URL changes before GitHub renders the new PR, so the
   * first read can see the previous PR's title, state and head. Re-read after
   * each re-render and re-register when anything changed (register is an upsert).
   */
  function refreshPageDetails() {
    const prev = state.pr
    if (!prev) return
    const next = parsePrRef(location.href, document)
    if (!next || next.number !== prev.number || repoKeyOf(next) !== repoKeyOf(prev)) return
    state.prState = readPrState(document)
    if (nativeAction && !resultHintSent && state.group && ((nativeAction === 'merge' && state.prState === 'merged') || (nativeAction === 'close' && state.prState === 'closed'))) {
      resultHintSent = true
      port?.send(envelope({ type: 'nativeResultHint' as const, documentId, groupId: state.group.groupId, pr: next, action: nativeAction }))
    }
    if (next.title !== prev.title || next.headSha !== prev.headSha) {
      state.pr = next
      registerCurrent()
      updateMaterialNotice()
    }
  }

  /** GitHub re-renders the page on soft navigation; put the list back if it was dropped. */
  function ensureList() {
    ensureQueued = false
    watchTurboFrame()
    if (showsOtherPr()) {
      applyLocation(location.href)
      return
    }
    refreshPageDetails()
    if (!state.pr || !store.currentGroupItem.value) {
      removeList()
      if (!store.currentGroupItem.value) materialNotice?.remove()
      return
    }
    const host = listUi?.shadowHost
    if (!host?.isConnected) void mountList()
    else queuePlaceList()
  }

  function queueEnsure() {
    if (ensureQueued) return
    ensureQueued = true
    requestAnimationFrame(ensureList)
  }

  function watchTurboFrame() {
    const frame = document.getElementById('repo-content-turbo-frame')
    if (frame === observedFrame) return
    observer?.disconnect()
    observedFrame = frame
    if (!frame) return
    observer = new MutationObserver(queueEnsure)
    observer.observe(frame, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-status', 'title', 'class'] })
  }

  /** True when the committed URL names another PR (or none) than the one this tab registered. */
  function showsOtherPr(): boolean {
    const next = parsePrRef(location.href)
    const prev = state.pr
    return (next?.number ?? null) !== (prev?.number ?? null) || (next && prev ? repoKeyOf(next) !== repoKeyOf(prev) : false)
  }

  function applyLocation(href: string) {
    const { changed } = readPage(href)
    if (changed) {
      nativeAction = null
      resultHintSent = false
      clearNextTimer()
      resultNotice?.remove()
      materialNotice?.remove()
      port?.send(envelope({ type: 'unregister' as const, documentId }))
      registerCurrent()
      state.messages.splice(0)
      void mountList()
    } else {
      queueEnsure()
    }
  }

  function clearNextTimer() {
    if (nextTimer) clearTimeout(nextTimer)
    nextTimer = null
  }

  function showNativeResult(outcome: 'merged' | 'closed') {
    clearNextTimer()
    resultNotice?.remove()
    const next = store.pendingGroupItems.value[0]
    const notice = document.createElement('div')
    notice.id = 'zenuml-review-result'
    notice.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;padding:15px 18px;border:1px solid #d0d7de;border-radius:8px;background:white;box-shadow:0 8px 28px #1f232833;color:#1f2328;font:13px system-ui,sans-serif'
    const label = document.createElement('span')
    label.textContent = outcome === 'merged' ? 'Merged. ' : 'Closed. '
    notice.append(label)
    if (next) {
      const go = document.createElement('button')
      go.type = 'button'
      go.textContent = 'Next'
      go.style.cssText = 'margin-left:8px;margin-right:8px'
      go.onclick = (event) => { event.stopPropagation(); clearNextTimer(); location.assign(next.pr.url ?? `https://${next.pr.host}/${next.pr.owner}/${next.pr.repo}/pull/${next.pr.number}`) }
      const stay = document.createElement('button')
      stay.type = 'button'
      stay.textContent = 'Stay'
      stay.onclick = (event) => { event.stopPropagation(); clearNextTimer(); label.textContent = 'Staying on this PR. ' }
      notice.append(go, stay)
      nextTimer = setTimeout(() => { nextTimer = null; location.assign(next.pr.url ?? `https://${next.pr.host}/${next.pr.owner}/${next.pr.repo}/pull/${next.pr.number}`) }, 3000)
    } else label.textContent += 'Round complete.'
    document.body.append(notice)
    resultNotice = notice
  }

  function onPageClick(event: PointerEvent) {
    if (nextTimer && resultNotice && !event.composedPath().includes(resultNotice)) clearNextTimer()
    if (!store.currentGroupItem.value || !event.isTrusted) return
    const button = (event.target as Element | null)?.closest('button, summary')
    const text = button?.textContent?.trim().toLowerCase() ?? ''
    if (/^(confirm merge|merge pull request|squash and merge|rebase and merge)/.test(text)) nativeAction = 'merge'
    else if (/^close pull request/.test(text)) nativeAction = 'close'
  }

  function onUserInteraction(event: Event) {
    if (nextTimer && (!resultNotice || !event.composedPath().includes(resultNotice))) clearNextTimer()
  }

  /**
   * In Chrome WXT fires this from the Navigation API `navigate` event, before the new URL commits,
   * so read the destination from the event, not from `location`. ensureList re-checks the committed
   * URL after GitHub renders, in case the event missed a navigation.
   */
  function onLocationChange(event: Event) {
    const newUrl = (event as Event & { newUrl?: URL }).newUrl
    applyLocation(newUrl?.href ?? location.href)
  }

  async function start() {
    readPage()
    try {
      Object.assign(state.prefs, await getPrefs())
    } catch {
      // storage unavailable (extension reloaded): keep defaults
    }
    ctx.onInvalidated(onPrefsChanged((change) => Object.assign(state.prefs, change)))

    port = new PanelPort({ getRepoKey: () => state.repoKey ?? undefined, onReconnect: () => registerCurrent() })
    port.onStatus((s) => (state.status = s))
    port.onFrame((f) => {
      store.applyFrame(f)
      if (f.type === 'group') {
        void mountList()
        updateMaterialNotice()
      }
      if (f.type === 'reviewItemResult' && f.documentId === documentId && f.source === 'native') {
        showNativeResult(f.outcome)
      }
      if (f.type === 'reviews') {
        telemetry('pr_panel_review_scope_applied', {
          scope_mode: 'mine',
          scope_outcome: state.viewerLogin ? 'resolved' : 'identity_unavailable',
          visible_review_count: store.visibleReviews.value.length,
          excluded_review_count: f.items.length - store.visibleReviews.value.length,
        })
        maybeSendListShown()
      }
    })
    port.connect()
    ctx.onInvalidated(() => {
      port?.send(envelope({ type: 'unregister' as const, documentId }))
      port?.disconnect()
      observer?.disconnect()
      // WXT removes the shadow-root UIs itself, but not the page-level content shift or the wheel guard.
      removeList()
    })

    await mountList()
    ctx.addEventListener(document, 'click', onPageClick, { capture: true })
    ctx.addEventListener(document, 'pointerdown', onUserInteraction, { capture: true })
    ctx.addEventListener(document, 'keydown', onUserInteraction, { capture: true })
    ctx.addEventListener(document, 'wheel', onUserInteraction, { capture: true, passive: true })
    watchTurboFrame()
    ctx.addEventListener(window, 'wxt:locationchange', onLocationChange)
    ctx.addEventListener(window, 'pagehide', () => port?.send(envelope({ type: 'unregister' as const, documentId })))
  }

  return { start, store }
}
