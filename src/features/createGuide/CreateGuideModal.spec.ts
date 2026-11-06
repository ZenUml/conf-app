import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CreateGuideModal from './CreateGuideModal.vue'

function prefersReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {} }))
}

describe('CreateGuideModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('plays the recorded guide for its variant: muted, looping, inline, autoplaying', () => {
    prefersReducedMotion(false)
    const wrapper = mount(CreateGuideModal, { props: { variant: 'graph', onClose: vi.fn() } })
    const video = wrapper.find('video')
    expect(video.attributes('src')).toBe('./video/create-guide-graph.mp4')
    expect((video.element as HTMLVideoElement).muted).toBe(true)
    expect((video.element as HTMLVideoElement).autoplay).toBe(true)
    expect(video.attributes()).toHaveProperty('loop')
    expect(video.attributes()).toHaveProperty('playsinline')
  })

  it('describes the animation for assistive tech, since the untitled Forge dialog has no name', () => {
    prefersReducedMotion(false)
    const wrapper = mount(CreateGuideModal, { props: { variant: 'zenuml', onClose: vi.fn() } })
    expect(wrapper.find('main').attributes('aria-label')).toMatch(/\/zenuml/)
  })

  it('closes with method "button" from its own close button', async () => {
    prefersReducedMotion(false)
    const onClose = vi.fn()
    const wrapper = mount(CreateGuideModal, { props: { variant: 'api', onClose } })
    await wrapper.find('button[aria-label="Close guide"]').trigger('click')
    expect(onClose).toHaveBeenCalledWith({ method: 'button' })
  })

  it('closes with method "escape" on Escape, because Confluence stops handling it once focus is inside', () => {
    prefersReducedMotion(false)
    const onClose = vi.fn()
    mount(CreateGuideModal, { props: { variant: 'api', onClose } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledWith({ method: 'escape' })
  })

  it('stops listening for Escape once unmounted', () => {
    prefersReducedMotion(false)
    const onClose = vi.fn()
    const wrapper = mount(CreateGuideModal, { props: { variant: 'api', onClose } })
    wrapper.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a still of the picked macro instead of playing when the user prefers reduced motion', () => {
    prefersReducedMotion(true)
    const wrapper = mount(CreateGuideModal, { props: { variant: 'zenuml', onClose: vi.fn() } })
    const video = wrapper.find('video').element as HTMLVideoElement
    expect(video.autoplay).toBe(false)
    expect(wrapper.find('video').attributes('src')).toBe('./video/create-guide-zenuml.mp4#t=5')
  })
})
