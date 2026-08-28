import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SupportedClientCarousel from './SupportedClientCarousel.vue'

describe('SupportedClientCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  afterEach(() => vi.useRealTimers())

  it('gently rotates only brands with shipped licensed marks', async () => {
    const wrapper = mount(SupportedClientCarousel)
    expect(wrapper.text()).toContain('Claude Code')
    expect(wrapper.text()).not.toContain('Codex')
    expect(wrapper.text()).not.toMatch(/\bPi\b/)

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.find('.agent-client-carousel__client').text()).toContain('Cursor')
  })

  it('stays on one static item when reduced motion is preferred', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const wrapper = mount(SupportedClientCarousel)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(wrapper.find('.agent-client-carousel__client').text()).toContain('Claude Code')
  })

  it('provides one concise non-animated accessible description', () => {
    const wrapper = mount(SupportedClientCarousel)
    const text = wrapper.find('.agent-client-carousel__sr-only').text()
    expect(text).toContain('Claude Code, Cursor, DeepSeek')
    expect(text).toContain('does not indicate what is installed or available')
  })
})
