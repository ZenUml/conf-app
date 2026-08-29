// AsyncAPI editor entry. Mounts AsyncApiStudioEditor (a thin React wrapper
// around an iframe that loads the vendored AsyncAPI Studio bundle from
// `./asyncapi-studio/index.html`). The Studio runs same-origin under the
// Forge resource so localStorage works as a sync channel.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView, isInserting, isConfiguring } from '@/model/globals/forgeGlobal'
import AsyncApiStudioEditor from '@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'
import AsyncApiForgeEditorShell from '@/components/Editor/AsyncApiEditor/AsyncApiForgeEditorShell.vue'
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'
import { tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate'
import { markPublishClicked, trackPublishCompleted } from '@/utils/analytics/publishTiming'
import { trackAuthoringStarted } from '@/utils/analytics/authoringStarted'
import { buildAsyncApiSaveDiagram } from '@/model/asyncapi/buildSaveDiagram'
// info.title → custom-content title mirroring now lives in
// buildAsyncApiSaveDiagram (it parses the spec when no explicit title is
// passed), so every save path stays in sync without each entry re-parsing.

const DEFAULT_ASYNCAPI_SPEC = `asyncapi: 3.0.0
info:
  title: Example AsyncAPI
  version: 1.0.0
  description: Replace this with your own AsyncAPI specification.
channels:
  example:
    address: example/channel
    messages:
      exampleMessage:
        payload:
          type: object
          properties:
            id:
              type: string
            value:
              type: number
operations:
  receiveExample:
    action: receive
    channel:
      $ref: '#/channels/example'
`

async function initializeMacro() {
  const context = await initForgeContext()
  // Read customContentId from config (macro context) AND modal context —
  // the dashboard's Edit flow opens this editor via a modal with the
  // contentId passed through extension.modal.customContentId.
  const configContentId = context.extension?.config?.customContentId
  const modalContentId = context.extension?.modal?.customContentId
  const customContentId = configContentId || modalContentId

  const entryPoint = context.extension?.type === 'confluence:spacePage'
    ? 'dashboard'
    : context.extension?.type === 'confluence:contentBylineItem'
      ? 'byline'
      : customContentId
        ? 'macro_toolbar'
        : 'page_editor'
  // Emit from this iframe, not the viewer that opened it: Session Replay is
  // scoped to an iframe, and the Studio interaction happens here.
  //
  // NOT fired here: on Lite the paywall can block this mount, and a user who
  // closes the paywall never started authoring. Fired below on the ungated
  // path, or from PaywallGate's explicit "Continue editing" — same rule
  // forgeIndex applies to the sequence family.
  //
  // Deferring it past the `loadFailed` early return below also stops a failed
  // document load counting as an authoring session. That is a deliberate
  // change on EVERY variant, not just Lite: the asyncapi app used to emit
  // macro_edit_started before it knew whether the document loaded, so its
  // start-vs-save funnel counted opens that could never reach a save.
  const trackAsyncApiAuthoringStarted = () => trackAuthoringStarted({
    macroType: 'asyncapi',
    entryPoint,
    customContentId,
  })

  // Dashboard edits open this editor as a standalone modal targeting a known
  // document id (modal.customContentId, with no macro on the current page).
  // The shared loader's cross-page-copy detection false-positives there — the
  // dashboard space page is never the content's origin page, so it stamps
  // isCopy=true and the save would CREATE a copy instead of updating in place
  // ("editing made a new diagram"). For that path, pin the save to the known
  // id; macro edits (config.customContentId) keep the normal copy-aware path.
  const isDashboardEdit = !configContentId && !!modalContentId

  let existing: Diagram | undefined
  let initialSpec = DEFAULT_ASYNCAPI_SPEC
  let loadFailed = false
  if (customContentId) {
    try {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId)
      existing = customContent?.value as Diagram | undefined
      const stored = existing?.code
      if (typeof stored === 'string' && stored.trim().length > 0) {
        initialSpec = stored
      }
    } catch (err) {
      console.error('Failed to load existing AsyncAPI spec:', err)
      loadFailed = true
    }
  }

  const root = document.getElementById('app')
  if (!root) {
    console.error('forge-asyncapi-editor: #app element missing')
    return
  }

  // If we were asked to edit a specific document but its load threw, do NOT
  // silently fall through to the DEFAULT_ASYNCAPI_SPEC editor: the user would
  // edit a blank template and the save would fork a brand-new document,
  // orphaning the one they meant to edit. Surface the failure instead.
  if (loadFailed) {
    ReactDOM.render(
      React.createElement(
        'div',
        {
          style: {
            display: 'flex', flexDirection: 'column', gap: '10px',
            alignItems: 'center', justifyContent: 'center', height: '100vh',
            padding: '20px', textAlign: 'center', color: '#DE350B',
          },
        },
        React.createElement('strong', null, 'Could not load this AsyncAPI document'),
        React.createElement(
          'span',
          { style: { color: '#42526E' } },
          'Close this dialog and try again. Editing now would create a new, separate document.',
        ),
      ),
      root,
    )
    return
  }

  const handleCancel = async () => {
    try {
      const view = await getView()
      await view.close()
    } catch (err) {
      console.error('Failed to close AsyncAPI editor:', err)
    }
  }

  const handleSave = async (spec: string) => {
    // Start the publish-latency clock at the save-handler entry (≈ the Studio
    // Publish click). Stopped at the redirect below. AsyncAPI submits inline
    // (no 500ms setTimeout), so its window excludes that delay by design.
    markPublishClicked()
    // buildAsyncApiSaveDiagram mirrors the spec's info.title onto the CC title
    // and (via pinToId) forces an in-place update for dashboard edits — see
    // isDashboardEdit above and the builder's docs.
    const sourceId = existing?.id ? String(existing.id) : ''
    const diagram = buildAsyncApiSaveDiagram({
      existing,
      spec,
      pinToId: isDashboardEdit ? customContentId : undefined,
    })
    const savedId = await saveToPlatform(diagram)
    const view = await getView()
    // Three reasons to write back the macro config via view.submit:
    //
    //  1. inserting — first save of a brand-new macro (page editor still
    //     needs the customContentId to wire the macro to its body).
    //  2. configuring — the user re-opened the editor on an existing
    //     macro from the *page editor* (not a modal viewer). The draft
    //     macro lives only in the page editor's ADF state until the
    //     page is published; on save we must update its config so a
    //     subsequent view-mode render reads the fresh content.
    //  3. idChanged — saveCustomContentV2 forked a new custom-content
    //     (cross-page-copy, same-page-duplicate, or the "count===0 on
    //     unpublished page" case where the v2 update path falls through
    //     to create). The macro params would otherwise still reference
    //     the source id while the new record sits orphaned. This is the
    //     same defect the OpenAPI/Swagger editor's save flow guards
    //     against — see forge-swagger-editor.ts (ZEN-1170 Defect 2b).
    //
    // Without check #2, a user inserting an asyncapi macro and then
    // re-editing it before publishing the page would call view.close()
    // here, the customContent server-side gets a fork (Y), and the
    // macro keeps rendering the original (X) — visible as "my edits
    // didn't save".
    const [inserting, configuring] = await Promise.all([isInserting(), isConfiguring()])
    const idChanged = !!sourceId && !!savedId && savedId !== sourceId
    // Redirect starts now (view.submit / view.close below). Stop the clock.
    trackPublishCompleted({
      macro_type: 'asyncapi',
      operation_mode: inserting ? 'create' : 'edit',
      content_id: String(savedId),
      custom_content_id: String(savedId),
    })
    if (inserting || configuring || idChanged) {
      // view.submit throws "this resource's view is not submittable" in
      // surfaces where the Forge runtime hasn't actually opened the editor
      // as a submit-capable modal — e.g. the dashboard-viewer Edit path
      // and some re-edit-on-draft contexts. The save itself has already
      // succeeded server-side at this point (saveToPlatform returned),
      // so the safe fallback is view.close(): the modal dismisses
      // cleanly and the macro picks up the new body on its next
      // re-render. Without this guard the user sees a red
      // "Error Loading AsyncAPI Studio — this resource's view is not
      // submittable" overlay even though their edit DID persist.
      try {
        await view.submit({
          config: { customContentId: savedId, updatedAt: new Date().toISOString() },
        })
      } catch (err) {
        console.warn('view.submit unavailable; closing modal instead', err)
        try { await view.close() } catch { /* best-effort */ }
      }
    } else {
      await view.close()
    }
  }

  // Skip the in-iframe title bar everywhere — the user prefers the
  // insert-flow layout (minimal Atlassian chrome row at the top, then
  // the Studio's own dark header with a floating Publish button) and
  // wants the same at edit time. ownTitleBar:false reproduces that
  // layout in every entry path.
  const mountStudio = (target: HTMLElement | null) => {
    if (!target) return
    ReactDOM.render(
      React.createElement(AsyncApiStudioEditor, {
        initialSpec,
        onSave: handleSave,
        onCancel: handleCancel,
        ownTitleBar: false,
      }),
      target,
    )
  }

  // Editor paywall (Lite): mount the Studio under PaywallGate so the iframe
  // is never blank — the block is the gate's modal on top of a real editor
  // (metered: "Continue editing (N)" dismisses it), not a refusal in
  // saveToPlatform. Same pattern as forge-swagger-editor.ts /
  // forge-graph-editor.ts — the gate no-ops on non-Lite variants
  // (shouldBlockActions is Lite-scoped).
  const paywalled = await tryPageEditorPaywall({
    doc: existing ?? NULL_DIAGRAM,
    content: AsyncApiForgeEditorShell,
    contentProps: {
      onMountedBootstrap: () => {
        mountStudio(document.getElementById('asyncapi-bootstrap-root'))
      },
    },
    macroKind: 'asyncapi',
    customContentId,
    // The gated path returns before the ungated mount below, so defer the
    // authoring event to the explicit continue action rather than counting a
    // blocked mount as an authoring session.
    onContinueEditing: trackAsyncApiAuthoringStarted,
  })
  if (!paywalled) {
    mountStudio(root)
    trackAsyncApiAuthoringStarted()
  }
}

void initializeMacro()
