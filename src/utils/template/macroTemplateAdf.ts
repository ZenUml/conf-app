export interface AdfNode {
  type: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
  text?: string
}

export interface AdfDoc {
  version: 1
  type: 'doc'
  content: AdfNode[]
}

export function buildMacroTemplateAdf({
  appId,
  environmentId,
  environmentType,
  macroKey,
}: {
  appId: string
  environmentId: string
  environmentType: string
  macroKey: string
}): AdfDoc {
  const extensionPath = `${appId}/${environmentId}/static/${macroKey}`
  return {
    version: 1,
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Design note' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Describe the change, then keep the diagram below current.' }] },
      {
        type: 'extension',
        attrs: {
          layout: 'default',
          extensionType: 'com.atlassian.ecosystem',
          extensionKey: extensionPath,
          text: 'Diagram',
          parameters: {
            layout: 'extension',
            forgeEnvironment: environmentType,
            extensionId: `ari:cloud:ecosystem::extension/${extensionPath}`,
            extensionTitle: 'Diagram',
            guestParams: {},
          },
        },
      },
    ],
  }
}
