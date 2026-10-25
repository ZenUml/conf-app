/**
 * Wires one GitHub tab: two shadow-root UIs (the floating Agent Panel and the
 * left review list), the `pr-panel` port to the broker, prefs, telemetry and
 * GitHub's soft navigation (Turbo / React router).
 */
import { createApp, h, type App } from 'vue'
import { repoKeyOf, type PrRef } from '@zenuml/pr-panel-shared'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createShadowRootUi, type ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root'
import { buildTelemetryFrame, messageLengthBucket, type TelemetryEvent, type TelemetryProps } from '../analytics/telemetry'
import { PanelPort, documentId, envelope } from '../bridge/port'
import { containWheel, installContentShift, listColumnTop } from '../pr/page-column'
import { parsePrRef, parseRepoRef, readPrState, readViewerLogin } from '../pr/identity'
import { getPrefs, onPrefsChanged, setPref } from '../state/prefs'
import AgentPanel from '../ui/AgentPanel.vue'
import ReviewList from '../ui/ReviewList.vue'
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

  // ---------------------------------------------------------------- panel
  async function mountPanel() {
    panelUi = await createShadowRootUi<App>(ctx, {
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
    panelUi.mount()
  }

  // ---------------------------------------------------------------- list
  async function mountList() {
    removeList()
    if (!state.pr) return
    const ui = await createShadowRootUi<App>(ctx, {
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
            h(ReviewList, {
              items: store.visibleReviews.value,
              currentPrNumber: state.pr?.number ?? null,
              emptyText:
                state.status.state === 'connected'
                  ? state.viewerLogin ? undefined : 'Sign in to GitHub to see only your PRs.'
                  : state.prefs.mcpAccess !== 'enabled' || state.status.needsPermission
                    ? 'Enable MCP access in the ZenUML panel to see AI reviews.'
                    : 'The ZenUML Hub is not running. Start your agent session to see AI reviews.',
              onOpen: (item: { url: string; stale: boolean }, index: number) => {
                telemetry('pr_panel_review_row_clicked', { row_index: index, is_stale: item.stale })
                location.assign(item.url)
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
    if (!state.pr) return
    removeList()
    listUi = ui
    ui.mount()
    undoContentShift = installContentShift(document)
    undoContainWheel = containWheel(ui.shadowHost)
    window.addEventListener('scroll', queuePlaceList, { passive: true })
    window.addEventListener('resize', queuePlaceList, { passive: true })
    listShownSent = false
    maybeSendListShown()
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
    if (listShownSent || !listUi || !state.reviewsLoaded) return
    listShownSent = true
    telemetry('pr_panel_review_list_shown', { review_count: store.visibleReviews.value.length })
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
    if (next.title !== prev.title || next.headSha !== prev.headSha) {
      state.pr = next
      registerCurrent()
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
    if (!state.pr) {
      removeList()
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
    observer.observe(frame, { childList: true, subtree: true })
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
      port?.send(envelope({ type: 'unregister' as const, documentId }))
      registerCurrent()
      state.messages.splice(0)
      void mountList()
    } else {
      queueEnsure()
    }
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

    await mountPanel()
    await mountList()
    watchTurboFrame()
    ctx.addEventListener(window, 'wxt:locationchange', onLocationChange)
    ctx.addEventListener(window, 'pagehide', () => port?.send(envelope({ type: 'unregister' as const, documentId })))
  }

  return { start, store }
}
