// AsyncAPI editor entry. Mounts AsyncApiStudioEditor (a thin React wrapper
// around an iframe that loads the vendored AsyncAPI Studio bundle from
// `./asyncapi-studio/index.html`). The Studio runs same-origin under the
// Forge resource so localStorage works as a sync channel.

import React from 'react'
import ReactDOM from 'react-dom'
import yaml from 'js-yaml'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView, isInserting, isConfiguring } from '@/model/globals/forgeGlobal'
import AsyncApiStudioEditor from '@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'
import { Diagram } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'
import { buildAsyncApiSaveDiagram } from '@/model/asyncapi/buildSaveDiagram'

// Pull `info.title` out of an AsyncAPI spec so the custom-content title
// in Confluence mirrors what the user wrote in the document. Both YAML
// and JSON parse via js-yaml. Falls back to undefined if the spec is
// malformed or has no `info.title` — the persistence layer then keeps
// either the previous title (on update) or generates an "Untitled <ts>"
// placeholder (on create).
function extractAsyncApiTitle(spec: string): string | undefined {
  try {
    const doc = yaml.load(spec) as Record<string, any> | null
    if (!doc || typeof doc !== 'object') return undefined
    const info = doc.info as Record<string, any> | undefined
    const title = info?.title
    if (typeof title !== 'string') return undefined
    const trimmed = title.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}

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
    }
  }

  const root = document.getElementById('app')
  if (!root) {
    console.error('forge-asyncapi-editor: #app element missing')
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
    const parsedTitle = extractAsyncApiTitle(spec)
    // Mirror the AsyncAPI doc's `info.title` into the custom-content title so
    // dashboard cards, recent activity, search, etc. surface the user-chosen
    // name instead of "Untitled <iso-date>". pinToId forces an in-place update
    // for dashboard edits (see isDashboardEdit above).
    const sourceId = existing?.id ? String(existing.id) : ''
    const diagram = buildAsyncApiSaveDiagram({
      existing,
      spec,
      title: parsedTitle,
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
  ReactDOM.render(
    React.createElement(AsyncApiStudioEditor, {
      initialSpec,
      onSave: handleSave,
      onCancel: handleCancel,
      ownTitleBar: false,
    }),
    root,
  )
}

void initializeMacro()
