// AsyncAPI viewer entry. Two render paths:
//
// 1. Macro context (page-rendered AsyncAPI macro): mount AsyncApiMacroViewer
//    (Vue) so the spec render sits inside GenericViewer — full host chrome
//    (Edit, Fullscreen, Export PNG, Versions, Copy page link — no diagram
//    deeplink button, since asyncapi has no mapped deeplink host).
//    Edit opens the editor modal via EventBus, matching the OpenAPI viewer.
//
// 2. Modal context (dashboard's "View" flow): render the React
//    AsyncApiViewer directly with an inline ✎ Edit button. Clicking Edit
//    swaps the React tree in place to the Studio editor — avoids Forge's
//    Modal.open() user-gesture requirement which would otherwise eat the
//    "close current modal, reopen as editor" flow.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId'
import { getContext as initForgeContext, getView, openModal } from '@/model/globals/forgeGlobal'
import AsyncApiViewer from '@/components/Viewer/AsyncApiViewer/AsyncApiViewer'
import macroMetrics from '@/services/MacroMetrics'
import { Diagram, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'
import { buildAsyncApiSaveDiagram } from '@/model/asyncapi/buildSaveDiagram'
import { mountRoot } from '@/mount-root'
import { guardEditClick } from '@/utils/guardEditClick'
import { trackAuthoringStarted } from '@/utils/analytics/authoringStarted'
import EventBus from './EventBus'
import { attributionFromCustomContent } from '@/model/DiagramAttribution'
import { publishDiagramAttribution } from '@/utils/viewerLoadOutcome'

// Captured at mount so the module-level EventBus 'edit' handler can forward the
// macro's document id into the edit modal. Without it the editor opens on the
// default spec and a save forks a new document instead of editing this one —
// and for embed macros it's what lets the modal edit the *referenced* doc.
let viewerCustomContentId: string | undefined

async function initializeMacro() {
  const context = await initForgeContext()
  // Read customContentId from config (macro context), modal context AND a
  // pasted typed deeplink — the dashboard's View flow opens this viewer via a
  // modal with the contentId passed through extension.modal.customContentId,
  // and a macro created by pasting `/d/asyncapi/<cloudId>/<contentId>` (the
  // link the Lite byline hands back after a create) has no config at all: the
  // id lives only in the matched URL that Confluence persists in the page ADF.
  // Reading config/modal directly here is exactly how the graph and openapi
  // viewers rendered a permanently blank macro for a pasted link — see the
  // docblock on resolveEffectiveCustomContentId.
  const customContentId = resolveEffectiveCustomContentId(context)
  viewerCustomContentId = customContentId

  let spec: string | undefined
  let existing: Diagram | undefined
  let loadError: string | undefined
  let attribution = null
  if (customContentId) {
    try {
      // Zero-network viewer copy check — see forge-graph-viewer.ts. Same-page
      // duplicates are caught on the Edit click (utils/guardEditClick.ts).
      const customContent = await globals.apWrapper.getCustomContentByIdV2(
        customContentId, { copyCheckMode: 'cross-page-only' },
      )
      existing = customContent?.value as Diagram | undefined
      attribution = attributionFromCustomContent(customContent)
      const stored = existing?.code
      if (typeof stored === 'string') spec = stored
    } catch (err) {
      // Common cause: the macro's saved customContentId points to a
      // record this app can't access — e.g. the doc was trashed, or
      // an earlier dev install wrote it under a customContent module
      // key that the current manifest doesn't register. Pass the
      // failure to the viewer so it can render a clear message
      // instead of the generic "no saved spec" empty state.
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Failed to load AsyncAPI spec for viewer (customContentId=${customContentId}):`, err)
      loadError = `Could not load this AsyncAPI document (id ${customContentId}). It may have been deleted, or stored under a custom-content type the current app doesn't claim.`
    }
  }

  const root = document.getElementById('app')
  if (!root) {
    console.error('forge-asyncapi-viewer: #app element missing')
    return
  }

  // The embed macro references a document owned elsewhere. On a published page
  // it must not offer an inline Edit pencil — editing the source happens at the
  // origin (dashboard / original macro), and re-targeting which document is
  // embedded stays a page-editor (macro-config) operation.
  const isEmbedMacro = (context.moduleKey ?? '').startsWith('zenuml-asyncapi-embed-macro')

  const macroMode = context.extension?.modal?.macroMode
  const isModal = !!macroMode
  // Both the macro Fullscreen viewer (macroMode 'fullscreen') and the
  // dashboard "View" modal (macroMode 'viewer') render on this modal path.
  // The inline ✎ Edit button belongs only to the dashboard view — the macro
  // fullscreen viewer is read-only chrome (editing is reached via Confluence's
  // macro toolbar / page editor), so it must not show an Edit affordance.
  const showInlineEdit = isModal && macroMode !== 'fullscreen'

  if (isModal) {
    // -------- Modal path (dashboard "View" + macro Fullscreen) --------
    // Inline React viewer. The dashboard view gets an Edit button that swaps
    // to the Studio editor in place (no second modal, no gesture loss); the
    // fullscreen macro viewer omits it (showInlineEdit === false).

    async function closeModal() {
      try {
        const view = await getView()
        await view.close()
      } catch (err) {
        console.error('Failed to close modal:', err)
      }
    }

    async function renderEditor() {
      try {
        // This path swaps the current viewer iframe into the editor instead of
        // loading forge-asyncapi-editor.ts, so start replay at the swap point.
        trackAuthoringStarted({
          macroType: 'asyncapi',
          entryPoint: 'dashboard',
          customContentId,
        })
        const [{ default: AsyncApiStudioEditor }] = await Promise.all([
          import('@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'),
        ])
        ReactDOM.render(
          React.createElement(AsyncApiStudioEditor, {
            initialSpec: spec,
            onSave: async (newSpec: string) => {
              // This in-place editor is only reached from the dashboard "View"
              // modal, which targets a known document id. Pin the save to that
              // id so it updates in place — the shared loader stamps a
              // false-positive isCopy on dashboard loads (dashboard page is
              // never the content's origin page), which would otherwise create
              // a copy instead of updating ("editing made a new diagram").
              const diagram = buildAsyncApiSaveDiagram({
                existing,
                spec: newSpec,
                pinToId: customContentId,
              })
              try {
                await saveToPlatform(diagram)
              } catch (err) {
                console.error('Save failed:', err)
                throw err
              }
              await closeModal()
            },
            onCancel: closeModal,
          }),
          root,
        )
      } catch (err) {
        console.error('Failed to swap viewer → editor:', err)
      }
    }

    ReactDOM.render(
      React.createElement(AsyncApiViewer, {
        spec,
        onEdit: showInlineEdit ? renderEditor : undefined,
        onCancel: closeModal,
        loadError,
      }),
      root,
    )
  } else {
    // -------- Page-rendered macro path --------
    // Mount the Vue wrapper so GenericViewer's chrome (Edit / Fullscreen /
    // Export PNG / Versions / Copy page link) shows up around the spec.
    const [{ default: AsyncApiMacroViewer }] = await Promise.all([
      import('@/components/Viewer/AsyncApiViewer/AsyncApiMacroViewer.vue'),
    ])
    const doc: Diagram = existing ?? { ...NULL_DIAGRAM, diagramType: DiagramType.AsyncApi, code: spec ?? '' }
    // Fullscreen viewer paywall (Lite): blocking modal over the read-only
    // spec on a saturated space. Same gate the other dedicated viewers get
    // via bootstrapForgeViewer; no-ops outside fullscreen and on non-Lite.
    const { tryFullscreenViewerPaywall } = await import('@/utils/paywall/mountPaywallGate')
    if (await tryFullscreenViewerPaywall({
      doc,
      content: AsyncApiMacroViewer,
      contentProps: { doc, loadError, hideEdit: isEmbedMacro },
      macroKind: 'asyncapi',
    })) return
    // mountRoot stuffs doc into the vuex store, but our Vue wrapper reads
    // from a `doc` prop (matches OpenApiViewer's signature). Pass it via
    // the props arg too — same for loadError, propagated from the
    // getCustomContentByIdV2 failure above so the viewer can render a
    // real error instead of the "no saved spec yet" placeholder.
    mountRoot(doc, AsyncApiMacroViewer, { doc, loadError, hideEdit: isEmbedMacro })
    publishDiagramAttribution(attribution)
  }

  // Match the metrics-reporting cadence of the other viewers so AsyncAPI
  // macros count toward the same per-space MacroMetrics tally.
  macroMetrics.reportMacroMetrics().catch((e) => console.debug('Metrics report failed (non-critical)', e))
}

void initializeMacro()

// GenericViewer's Edit button emits an 'edit' event on the global EventBus.
// Mirror the OpenAPI viewer pattern: open an editor modal in fullscreen
// macroMode so the asyncapi editor runs in its own iframe with full
// Studio chrome.
EventBus.$on('edit', async () => {
  try {
    // Same-page duplicate gate — see forge-graph-viewer.ts. Memoized, so the
    // shared forgeIndex listener firing on this same click costs no extra GET.
    if (!(await guardEditClick({ customContentId: viewerCustomContentId, macroType: 'asyncapi' }))) return;

    await openModal({
      resource: 'main',
      onClose: () => {
        // Reload the macro iframe so any saved changes show up.
        location.reload()
      },
      size: 'fullscreen',
      context: {
        macroMode: 'editor',
        diagramType: 'asyncapi',
        // Forward the macro's document id so the editor loads and saves THIS
        // document in place. For an embed macro this is the referenced doc:
        // editing it here updates the live reference's content. (Re-targeting
        // which document is embedded stays a page-editor operation — see
        // resolveAsyncApiEditorEntry.)
        customContentId: viewerCustomContentId,
      },
    })
  } catch (err) {
    console.error('Failed to open AsyncAPI editor modal from viewer:', err)
  }
})
