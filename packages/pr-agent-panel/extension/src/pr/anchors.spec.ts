import { describe, expect, it } from 'vitest'
import { findLayout } from './anchors'
import fixture from './__fixtures__/pr-page.html?raw'

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html')

describe('findLayout', () => {
  it('finds SplitPageLayout.Content and the conversation sidebar on a real (trimmed) PR page', () => {
    const layout = findLayout(doc(fixture))
    expect(layout).not.toBeNull()
    expect(layout!.contentNode.getAttribute('data-component')).toBe('SplitPageLayout.Content')
    expect(layout!.insertBeforeNode).toBe(layout!.contentNode)
    expect(layout!.sidebarNode?.id).toBe('pr-conversation-sidebar')
    // The list goes into the same row as the conversation and its sidebar, left of both.
    expect(layout!.contentNode.parentElement!.contains(layout!.sidebarNode!)).toBe(true)
  })

  it('ignores a Content node whose parent holds neither the sidebar nor the discussion', () => {
    const d = doc('<div><div data-component="SplitPageLayout.Content"></div></div>')
    expect(findLayout(d)).toBeNull()
  })

  it('falls back to the classic .js-discussion inside the pjax container', () => {
    const d = doc('<div id="repo-content-pjax-container"><div class="js-discussion" id="disc"></div></div>')
    const layout = findLayout(d)
    expect(layout?.contentNode.id).toBe('disc')
    expect(layout?.insertBeforeNode.id).toBe('disc')
    expect(layout?.sidebarNode).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(findLayout(doc('<!doctype html><main><h1>Pull requests</h1><ul class="js-navigation-container"></ul></main>'))).toBeNull()
  })
})
