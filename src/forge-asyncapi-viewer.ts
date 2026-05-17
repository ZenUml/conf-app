// AsyncAPI viewer entry. Renders @asyncapi/react-component as a static
// read-only view. The Studio iframe is editor-only — viewer uses the
// dedicated react-component for a cleaner render with no bundle bloat
// from the Studio's Monaco-based editor surface.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView } from '@/model/globals/forgeGlobal'
import AsyncApiViewer from '@/components/Viewer/AsyncApiViewer/AsyncApiViewer'
import macroMetrics from '@/services/MacroMetrics'

async function initializeMacro() {
  const context = await initForgeContext()
  // Read customContentId from config (macro context) AND modal context —
  // the dashboard's View flow opens this viewer via a modal with the
  // contentId passed through extension.modal.customContentId.
  const customContentId =
    context.extension?.config?.customContentId ||
    context.extension?.modal?.customContentId

  let spec: string | undefined
  if (customContentId) {
    try {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId)
      const stored = customContent?.value?.code
      if (typeof stored === 'string') spec = stored
    } catch (err) {
      console.error('Failed to load AsyncAPI spec for viewer:', err)
    }
  }

  const root = document.getElementById('app')
  if (!root) {
    console.error('forge-asyncapi-viewer: #app element missing')
    return
  }

  // Render an Edit button only when this viewer is rendered inside a
  // modal opened from the asyncapi dashboard (extension.modal.macroMode
  // is set). On a regular Confluence page-rendered macro there's no modal,
  // and edit is reached via Confluence's own macro toolbar — the dashboard
  // affordance would just be a duplicate.
  const isModal = !!context.extension?.modal?.macroMode
  const onEdit = isModal
    ? async () => {
        try {
          const view = await getView()
          await view.submit({ action: 'edit' })
        } catch (err) {
          console.error('Failed to submit edit intent from viewer:', err)
        }
      }
    : undefined

  ReactDOM.render(React.createElement(AsyncApiViewer, { spec, onEdit }), root)

  // Match the metrics-reporting cadence of the other viewers so AsyncAPI
  // macros count toward the same per-space MacroMetrics tally.
  macroMetrics.reportMacroMetrics().catch((e) => console.debug('Metrics report failed (non-critical)', e))
}

void initializeMacro()
