// AsyncAPI viewer entry. Renders @asyncapi/react-component as a static
// read-only view. The Studio iframe is editor-only — viewer uses the
// dedicated react-component for a cleaner render with no bundle bloat
// from the Studio's Monaco-based editor surface.
//
// When this entry is hosted inside a dashboard-opened modal it also wires
// an Edit button. Clicking Edit re-mounts the React tree INSIDE the same
// modal as the Studio editor (dynamic import) — we deliberately do NOT
// close-and-reopen as a new modal because Forge's Modal.open() requires a
// user gesture within the synchronous click handler, which is lost across
// the async view.close → onClose → openModal hop.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView } from '@/model/globals/forgeGlobal'
import AsyncApiViewer from '@/components/Viewer/AsyncApiViewer/AsyncApiViewer'
import macroMetrics from '@/services/MacroMetrics'
import { DataSource, Diagram, DiagramType } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'

async function initializeMacro() {
  const context = await initForgeContext()
  // Read customContentId from config (macro context) AND modal context —
  // the dashboard's View flow opens this viewer via a modal with the
  // contentId passed through extension.modal.customContentId.
  const customContentId =
    context.extension?.config?.customContentId ||
    context.extension?.modal?.customContentId

  let spec: string | undefined
  let existing: Diagram | undefined
  if (customContentId) {
    try {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId)
      existing = customContent?.value as Diagram | undefined
      const stored = existing?.code
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

  const isModal = !!context.extension?.modal?.macroMode

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
      // Dynamic import keeps the Studio editor chunk out of the viewer
      // bundle until the user actually clicks Edit.
      const [{ default: AsyncApiStudioEditor }] = await Promise.all([
        import('@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'),
      ])
      ReactDOM.render(
        React.createElement(AsyncApiStudioEditor, {
          initialSpec: spec,
          onSave: async (newSpec: string) => {
            const diagram: Diagram = {
              ...(existing ?? {}),
              diagramType: DiagramType.AsyncApi,
              code: newSpec,
              source: DataSource.CustomContent,
            } as Diagram
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
        root!,
      )
    } catch (err) {
      console.error('Failed to swap viewer → editor:', err)
    }
  }

  // Render the read-only viewer first. The Edit button (in-modal only)
  // re-mounts the Studio editor in place.
  ReactDOM.render(
    React.createElement(AsyncApiViewer, {
      spec,
      onEdit: isModal ? renderEditor : undefined,
    }),
    root,
  )

  // Match the metrics-reporting cadence of the other viewers so AsyncAPI
  // macros count toward the same per-space MacroMetrics tally.
  macroMetrics.reportMacroMetrics().catch((e) => console.debug('Metrics report failed (non-critical)', e))
}

void initializeMacro()
