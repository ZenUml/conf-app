// AsyncAPI editor entry. Mounts AsyncApiStudioEditor (a thin React wrapper
// around an iframe that loads the vendored AsyncAPI Studio bundle from
// `./asyncapi-studio/index.html`). The Studio runs same-origin under the
// Forge resource so localStorage works as a sync channel.
//
// Scope (PR #2): render the editor, validate that the Studio iframe loads
// inside the Forge Custom UI runtime, and that localStorage polling sees
// changes. Save/persist wiring (custom-content storage, DiagramType enum
// extension, mixpanel events) lands in PR #3.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView } from '@/model/globals/forgeGlobal'
import AsyncApiStudioEditor from '@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'

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
  const customContentId = context.extension?.config?.customContentId

  let initialSpec = DEFAULT_ASYNCAPI_SPEC
  if (customContentId) {
    try {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId)
      const stored = customContent?.value?.code
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

  const handleSpecChange = (spec: string) => {
    // PR #2 stub: log only so we can verify the same-origin localStorage
    // polling actually surfaces edits from inside the Studio iframe.
    // PR #3 will dispatch this to the store and persist via saveToPlatform.
    console.debug('asyncapi spec changed (length:', spec.length, ')')
  }

  ReactDOM.render(
    React.createElement(AsyncApiStudioEditor, {
      initialSpec,
      onSpecChange: handleSpecChange,
      onCancel: handleCancel,
      // onSave intentionally omitted: PR #3 wires this to saveToPlatform
      // once the AsyncApi DiagramType + custom-content shape are in place.
    }),
    root,
  )
}

void initializeMacro()
