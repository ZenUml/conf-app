// AsyncAPI viewer entry. Two render paths:
//
// 1. Macro context (page-rendered AsyncAPI macro): mount AsyncApiMacroViewer
//    (Vue) so the spec render sits inside GenericViewer — full host chrome
//    (Edit, Fullscreen, Copy code, Export PNG, Versions, Copy link).
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
import { getContext as initForgeContext, getView, openModal } from '@/model/globals/forgeGlobal'
import AsyncApiViewer from '@/components/Viewer/AsyncApiViewer/AsyncApiViewer'
import macroMetrics from '@/services/MacroMetrics'
import { DataSource, Diagram, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'
import { mountRoot } from '@/mount-root'
import EventBus from './EventBus'

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

  if (isModal) {
    // -------- Dashboard modal path --------
    // Inline React viewer with an Edit button that swaps to the Studio
    // editor in place (no second modal, no gesture loss).

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
          root,
        )
      } catch (err) {
        console.error('Failed to swap viewer → editor:', err)
      }
    }

    ReactDOM.render(
      React.createElement(AsyncApiViewer, { spec, onEdit: renderEditor }),
      root,
    )
  } else {
    // -------- Page-rendered macro path --------
    // Mount the Vue wrapper so GenericViewer's chrome (Edit / Fullscreen /
    // Export PNG / Versions / Copy link) shows up around the spec.
    const [{ default: AsyncApiMacroViewer }] = await Promise.all([
      import('@/components/Viewer/AsyncApiViewer/AsyncApiMacroViewer.vue'),
    ])
    const doc: Diagram = existing ?? { ...NULL_DIAGRAM, diagramType: DiagramType.AsyncApi, code: spec ?? '' }
    // mountRoot stuffs doc into the vuex store, but our Vue wrapper reads
    // from a `doc` prop (matches OpenApiViewer's signature). Pass it via
    // the props arg too.
    mountRoot(doc, AsyncApiMacroViewer, { doc })
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
      },
    })
  } catch (err) {
    console.error('Failed to open AsyncAPI editor modal from viewer:', err)
  }
})
