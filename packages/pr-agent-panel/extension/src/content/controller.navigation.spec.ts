// @vitest-environment-options {"url":"https://github.com/example-owner/example-repo/pulls"}
import { afterEach, describe, expect, it, vi } from 'vitest'

// Chrome has the Navigation API, so WXT's location watcher fires on `navigate`, before the new URL
// commits. jsdom has none and WXT would poll instead, so stub it before WXT loads.
const navigation = new EventTarget()
vi.stubGlobal('navigation', navigation)

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-zenuml-pr-list')
})

const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

function softNavigate(url: string) {
  const event = Object.assign(new Event('navigate'), { destination: { url } })
  navigation.dispatchEvent(event) // location.href is still the old URL here
  history.pushState(null, '', url)
  document.getElementById('repo-content-turbo-frame')!.append(document.createElement('div')) // GitHub renders the PR
}

describe('createPageController soft navigation', () => {
  it('picks up a PR reached by soft navigation from /pulls, whose navigate event fires before the URL commits', async () => {
    const { ContentScriptContext } = await import('wxt/utils/content-script-context')
    const { createPageController } = await import('./controller')
    document.body.innerHTML = '<nav aria-label="Repository"></nav><turbo-frame id="repo-content-turbo-frame"></turbo-frame>'
    const ctx = new ContentScriptContext('github')
    const controller = createPageController(ctx)
    await controller.start()
    expect(document.querySelector('zenuml-pr-list')).toBeNull()

    controller.store.applyFrame({
      v: 1, id: 'group-frame', ts: Date.now(), type: 'group', preparation: null,
      group: { groupId: 'g1', product: 'Example', requestedCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
        items: [{ pr: { host: 'github.com', owner: 'example-owner', repo: 'example-repo', number: 7 }, decisionTitle: 'Review seven', ci: 'pending', materialHeadSha: '7777777', materialUpdatedAt: 1, outcome: 'pending' }] },
    })

    softNavigate('https://github.com/example-owner/example-repo/pull/7')
    await frames()
    await frames()

    expect(controller.store.state.pr?.number).toBe(7)
    expect(document.querySelector('zenuml-pr-list')).not.toBeNull()

    // PR 7's page carries its own title and head; the navigate event for PR 8 fires while it is still shown.
    const frame = document.getElementById('repo-content-turbo-frame')!
    frame.innerHTML = `<bdi class="js-issue-title">Seven</bdi><span class="commit-ref"></span><span class="sha">${'7'.repeat(40)}</span>`
    const event = Object.assign(new Event('navigate'), { destination: { url: 'https://github.com/example-owner/example-repo/pull/8' } })
    navigation.dispatchEvent(event)
    expect(controller.store.state.pr?.number).toBe(8)
    expect(controller.store.state.pr?.headSha).toBeUndefined()
    expect(controller.store.state.pr?.title).toBeUndefined()

    history.pushState(null, '', 'https://github.com/example-owner/example-repo/pull/8')
    frame.innerHTML = `<bdi class="js-issue-title">Eight</bdi><span class="commit-ref"></span><span class="sha">${'8'.repeat(40)}</span>`
    await frames()
    await frames()
    expect(controller.store.state.pr?.headSha).toBe('8'.repeat(40))
    expect(controller.store.state.pr?.title).toBe('Eight')
    ctx.notifyInvalidated()
  })

  it('does nothing, and throws nothing, when the extension was reloaded under an open tab', async () => {
    vi.resetModules()
    const { browser } = await import('wxt/browser')
    const { ContentScriptContext } = await import('wxt/utils/content-script-context')
    const { createPageController } = await import('./controller')
    history.replaceState(null, '', 'https://github.com/example-owner/example-repo/pulls')
    document.body.innerHTML = '<nav aria-label="Repository"></nav><turbo-frame id="repo-content-turbo-frame"></turbo-frame>'
    const ctx = new ContentScriptContext('github')
    await createPageController(ctx).start()

    // What an orphaned content script sees after the extension reloads.
    const id = browser.runtime.id
    vi.spyOn(browser.runtime, 'getURL').mockImplementation(() => {
      throw new Error('Extension context invalidated.')
    })
    Object.defineProperty(browser.runtime, 'id', { value: undefined, configurable: true })
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      softNavigate('https://github.com/example-owner/example-repo/pull/7')
      await frames()
      await frames()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(rejections).toEqual([])
      expect(document.querySelector('zenuml-pr-list')).toBeNull()
    } finally {
      process.off('unhandledRejection', onRejection)
      Object.defineProperty(browser.runtime, 'id', { value: id, configurable: true })
      vi.restoreAllMocks()
    }
  })
})
