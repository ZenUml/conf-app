// AsyncAPI editor entry. Mounts AsyncApiStudioEditor (a thin React wrapper
// around an iframe that loads the vendored AsyncAPI Studio bundle from
// `./asyncapi-studio/index.html`). The Studio runs same-origin under the
// Forge resource so localStorage works as a sync channel.

import React from 'react'
import ReactDOM from 'react-dom'
import yaml from 'js-yaml'

import globals from '@/model/globals'
import { getContext as initForgeContext, getView, isInserting } from '@/model/globals/forgeGlobal'
import AsyncApiStudioEditor from '@/components/Editor/AsyncApiEditor/AsyncApiStudioEditor'
import { DataSource, Diagram, DiagramType } from '@/model/Diagram/Diagram'
import { saveToPlatform } from '@/model/ContentProvider/Persistence'

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
    const parsedTitle = extractAsyncApiTitle(spec)
    const diagram: Diagram = {
      ...(existing ?? {}),
      diagramType: DiagramType.AsyncApi,
      code: spec,
      source: DataSource.CustomContent,
      // Mirror the AsyncAPI doc's `info.title` into the custom-content
      // title so dashboard cards, recent activity, search, etc. all
      // surface the user-chosen name instead of "Untitled <iso-date>".
      ...(parsedTitle ? { title: parsedTitle } : {}),
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
