// @vitest-environment-options {"url":"https://github.com/example-owner/example-repo/pull/7"}
import { afterEach, describe, expect, it } from 'vitest'
import { ContentScriptContext } from 'wxt/utils/content-script-context'
import { CONTENT_SHIFT_STYLE_ID } from '../pr/page-column'
import { createPageController } from './controller'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-zenuml-pr-list')
})

describe('createPageController teardown', () => {
  it('removes the list and the page content shift when the content script is invalidated', async () => {
    document.body.innerHTML = '<nav aria-label="Repository"></nav><turbo-frame id="repo-content-turbo-frame"></turbo-frame>'
    const ctx = new ContentScriptContext('github')
    await createPageController(ctx).start()
    expect(document.querySelector('zenuml-pr-list')).not.toBeNull()
    expect(document.getElementById(CONTENT_SHIFT_STYLE_ID)).not.toBeNull()

    ctx.notifyInvalidated()

    expect(document.querySelector('zenuml-pr-list')).toBeNull()
    expect(document.getElementById(CONTENT_SHIFT_STYLE_ID)).toBeNull()
    expect(document.documentElement.hasAttribute('data-zenuml-pr-list')).toBe(false)
  })
})
