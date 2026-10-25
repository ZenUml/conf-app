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
})
