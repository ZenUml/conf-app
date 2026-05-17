// AsyncAPI viewer entry. Read-only Studio render for now — the real viewer
// using @asyncapi/react-component lands in PR #3 once the persistence /
// custom-content shape settles. Reusing the Studio iframe in `?readOnly=true`
// mode keeps PR #2 focused on the same-origin loading question.

import React from 'react'
import ReactDOM from 'react-dom'

import globals from '@/model/globals'
import { getContext as initForgeContext } from '@/model/globals/forgeGlobal'
import AsyncApiStudioEditor from '@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'

async function initializeMacro() {
  const context = await initForgeContext()
  const customContentId = context.extension?.config?.customContentId

  let initialSpec: string | undefined
  if (customContentId) {
    try {
      const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId)
      const stored = customContent?.value?.code
      if (typeof stored === 'string' && stored.trim().length > 0) {
        initialSpec = stored
      }
    } catch (err) {
      console.error('Failed to load AsyncAPI spec for viewer:', err)
    }
  }

  const root = document.getElementById('app')
  if (!root) {
    console.error('forge-asyncapi-viewer: #app element missing')
    return
  }

  ReactDOM.render(
    React.createElement(AsyncApiStudioEditor, {
      initialSpec,
      readOnly: true,
    }),
    root,
  )
}

void initializeMacro()
