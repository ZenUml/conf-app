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

    softNavigate('https://github.com/example-owner/example-repo/pull/8')
    await frames()
    await frames()
    expect(controller.store.state.pr?.number).toBe(8)
    ctx.notifyInvalidated()
  })
})
