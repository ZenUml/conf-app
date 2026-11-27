import { describe, expect, it } from 'vitest'
import { diagramReturnPath, parseFullscreenSource } from './fullscreenSource'

describe('Fullscreen Plan and usage source', () => {
  it('takes only finite scenarios and a numeric return page from Forge location', () => {
    const source = parseFullscreenSource('https://example.atlassian.net/wiki/apps/app/env/zenuml-plan-usage?source=fullscreen_recovery&request=untrusted&scenes=present,other,present,arbitrary&page_id=12345&space_key=SPACE%20A')
    expect(source).toEqual({ feature: 'fullscreen', scenarios: ['present', 'other'], pageId: '12345', spaceKey: 'SPACE A' })
    expect(diagramReturnPath(source!)).toBe('/wiki/pages/viewpage.action?pageId=12345')
  })

  it('rejects other sources and unsafe return ids', () => {
    expect(parseFullscreenSource('https://example.atlassian.net/wiki/apps/x?source=other')).toBeNull()
    expect(parseFullscreenSource('https://example.atlassian.net/wiki/apps/x?source=fullscreen_recovery&page_id=123%26evil%3D1')).toEqual({ feature: 'fullscreen', scenarios: [] })
    expect(parseFullscreenSource('not a URL')).toBeNull()
    expect(parseFullscreenSource('https://example.atlassian.net/wiki/apps/x?source=fullscreen_recovery&feature=print')).toBeNull()
  })

  it('reads an edit gate with its own scenarios, not the Fullscreen ones', () => {
    expect(parseFullscreenSource('https://example.atlassian.net/wiki/apps/x?source=fullscreen_recovery&feature=edit&space_key=ENG&scenes=fix_or_update,present'))
      .toEqual({ feature: 'edit', scenarios: ['fix_or_update'], spaceKey: 'ENG' })
  })
})
