// AsyncAPI embed-macro editor entry. Renders a doc picker
// (AsyncApiEmbedEditor) and submits the picked customContentId via
// view.submit() so the page persists it as the macro's config — the
// regular AsyncAPI viewer (forge-asyncapi-viewer.ts) then reads
// extension.config.customContentId at render time, no separate viewer
// entry needed.
//
// Mirrors AsyncAPI-Conf-V2's src/pages/embed-editor.tsx but adapted to
// the merged variant's globals + Forge bridge.

import React from 'react'
import { createRoot } from 'react-dom/client'
import uuidv4 from '@/utils/uuid'
import { getContext, getView } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { trackAuthoringStarted } from '@/utils/analytics/authoringStarted'
import AsyncApiEmbedEditor, {
  AsyncApiEmbedPick,
} from '@/components/Editor/AsyncApiEmbedEditor/AsyncApiEmbedEditor'

async function initializeMacro() {
  const context = await getContext()
  const customContentId = context.extension?.config?.customContentId
  trackAuthoringStarted({
    macroType: 'embed',
    entryPoint: customContentId ? 'macro_toolbar' : 'page_editor',
    customContentId,
  })

  const root = document.getElementById('app')
  if (!root) {
    console.error('forge-asyncapi-embed-editor: #app element missing')
    return
  }

  const handleSelect = async ({ customContentId, title }: AsyncApiEmbedPick) => {
    try {
      const view = await getView()
      // Match the config shape used by the regular asyncapi macro so the
      // viewer flow (forge-asyncapi-viewer.ts) reads either kind via the
      // same `extension.config.customContentId` lookup. The `uuid` field
      // keeps the macro instance distinct from others embedding the same
      // document (used by per-instance analytics + page-capture).
      await view.submit({
        config: {
          uuid: uuidv4(),
          customContentId,
          documentTitle: title,
          diagramName: title,
          updatedAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      // view.submit() throws "this resource's view is not submittable" on any
      // surface that isn't the native page-editor config gesture. forgeIndex
      // now routes the picker only to that submittable surface, but guard
      // anyway: tell the user where re-targeting actually works instead of the
      // old dead-end "try again" loop (the retry never could have succeeded).
      const msg = err instanceof Error ? err.message : String(err)
      const notSubmittable = /not submittable/i.test(msg)
      console.error('Failed to submit embed macro selection:', err)
      trackAnalyticsEvent('embed_retarget_blocked', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: 'embed',
        operation_mode: 'edit',
        failure_reason: notSubmittable ? 'view_not_submittable' : msg.slice(0, 120),
      })
      window.alert(
        notSubmittable
          ? 'To change which document this macro embeds, edit it from the page editor: open the page in Edit mode, select the macro, and choose Edit. Re-targeting an embed isn’t available from the view-mode editor.'
          : 'Failed to embed document. Please try again.',
      )
    }
  }

  const handleCancel = async () => {
    try {
      const view = await getView()
      await view.close({ submitted: false })
    } catch (err) {
      console.error('Failed to close embed editor:', err)
    }
  }

  createRoot(root).render(
    React.createElement(AsyncApiEmbedEditor, {
      onSelect: handleSelect,
      onCancel: handleCancel,
    }),
  )
}

void initializeMacro()
