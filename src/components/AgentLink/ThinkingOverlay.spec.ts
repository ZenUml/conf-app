import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ThinkingOverlay from './ThinkingOverlay.vue'

describe('ThinkingOverlay', () => {
  it('renders nothing when idle (flag-off / no-session DOM is unchanged)', () => {
    const wrapper = mount(ThinkingOverlay, { props: { state: 'idle' } })

    expect(wrapper.find('[data-testid="agent-thinking-overlay"]').exists()).toBe(false)
    expect(wrapper.html()).toBe('<!--v-if-->')
  })

  it('shows the spinner + "updating" label when thinking (design-system spinner, not a shimmer)', () => {
    const wrapper = mount(ThinkingOverlay, { props: { state: 'thinking' } })

    const overlay = wrapper.find('[data-testid="agent-thinking-overlay"]')
    expect(overlay.exists()).toBe(true)
    expect(overlay.classes()).toContain('agent-thinking-overlay--thinking')
    // ArrowPathIcon spinner is present; the error icon is not.
    expect(wrapper.find('[data-testid="agent-thinking-spinner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-thinking-error-icon"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-thinking-label"]').text()).toMatch(/updating the diagram/i)
    // No skeleton-shimmer CLASS anywhere (design-system constraint: spinner, not sweep).
    const classAttrs = wrapper.findAll('*').map((el) => el.attributes('class') || '').join(' ')
    expect(classAttrs).not.toMatch(/shimmer|skeleton/i)
  })

  it('shows the error cue (no spinner) when in the error state', () => {
    const wrapper = mount(ThinkingOverlay, { props: { state: 'error' } })

    const overlay = wrapper.find('[data-testid="agent-thinking-overlay"]')
    expect(overlay.exists()).toBe(true)
    expect(overlay.classes()).toContain('agent-thinking-overlay--error')
    expect(wrapper.find('[data-testid="agent-thinking-spinner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-thinking-error-icon"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-thinking-label"]').text()).toMatch(/did not apply/i)
  })

  it('carries an accessible live-region role for screen readers', () => {
    const wrapper = mount(ThinkingOverlay, { props: { state: 'thinking' } })
    const overlay = wrapper.find('[data-testid="agent-thinking-overlay"]')

    expect(overlay.attributes('role')).toBe('status')
    expect(overlay.attributes('aria-live')).toBe('polite')
  })
})
