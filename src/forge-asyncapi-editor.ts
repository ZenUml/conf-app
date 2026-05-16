// AsyncAPI editor entry. Mounts AsyncApiStudioEditor (a thin React wrapper
// around an iframe that loads the vendored AsyncAPI Studio bundle from
// `./asyncapi-studio/index.html`). The Studio runs same-origin under the
// Forge resource so localStorage works as a sync channel.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView, isInserting } from '@/model/globals/forgeGlobal'
import AsyncApiStudioEditor from '@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'
import { DataSource, Diagram, DiagramType } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'

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
  const customContentId =
    context.extension?.config?.customContentId ||
    context.extension?.modal?.customContentId

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
    const diagram: Diagram = {
      ...(existing ?? {}),
      diagramType: DiagramType.AsyncApi,
      code: spec,
      source: DataSource.CustomContent,
    } as Diagram
    const savedId = await saveToPlatform(diagram)
    const view = await getView()
    if (await isInserting()) {
      await view.submit({
        config: { customContentId: savedId, updatedAt: new Date().toISOString() },
      })
    } else {
      await view.close()
    }
  }

  ReactDOM.render(
    React.createElement(AsyncApiStudioEditor, {
      initialSpec,
      onSave: handleSave,
      onCancel: handleCancel,
    }),
    root,
  )
}

void initializeMacro()
