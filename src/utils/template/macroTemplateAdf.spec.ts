import { describe, expect, it } from 'vitest'
import { buildMacroTemplateAdf } from './macroTemplateAdf'

describe('buildMacroTemplateAdf', () => {
  it('creates a Forge macro extension without an instance custom-content identifier', () => {
    const document = buildMacroTemplateAdf({ appId: 'app-1', environmentId: 'env-1', environmentType: 'STAGING', macroKey: 'zenuml-sequence-macro-lite' })
    expect(document.content.map(node => node.type)).toEqual(['heading', 'paragraph', 'extension'])
    expect(document.content[2]).toMatchObject({
      attrs: {
        extensionKey: 'app-1/env-1/static/zenuml-sequence-macro-lite',
        parameters: { forgeEnvironment: 'STAGING', guestParams: {} },
      },
    })
    expect(JSON.stringify(document)).not.toContain('customContent')
    expect(JSON.stringify(document)).not.toContain('localId')
  })
})
