import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import { MOCK_KEYS } from '@/components/Debug/presets'
import PresetDropdown from '@/components/Debug/PresetDropdown.vue'

const reload = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  for (const k of MOCK_KEYS) localStorage.removeItem(k)
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    configurable: true,
  })
})

describe('PresetDropdown', () => {
  it('shows "—" when no preset matches current localStorage', () => {
    localStorage.setItem('mockMacroCount', '999')
    const wrapper = mount(PresetDropdown)
    expect(wrapper.get('[data-testid="preset-active"]').text()).toBe('—')
  })

  it('shows the preset name when a preset matches', () => {
    localStorage.setItem('mockCSSEnabled', 'true')
    localStorage.setItem('mockMacroCount', '120')
    localStorage.setItem('mockSpacePaid', 'false')
    const wrapper = mount(PresetDropdown)
    expect(wrapper.get('[data-testid="preset-active"]').text()).toBe('Lite blocked')
  })

  it('renders all preset items when toggled', async () => {
    const wrapper = mount(PresetDropdown)
    await wrapper.get('[data-testid="preset-trigger"]').trigger('click')
    const items = wrapper.findAll('[data-testid="preset-item"]')
    expect(items.map((w) => w.text())).toEqual([
      'Reset',
      'Lite blocked',
    ])
  })

  it('clicking a preset item writes its signature and reloads', async () => {
    const wrapper = mount(PresetDropdown)
    await wrapper.get('[data-testid="preset-trigger"]').trigger('click')
    const liteBlocked = wrapper.findAll('[data-testid="preset-item"]')
      .find((w) => w.text() === 'Lite blocked')!
    await liteBlocked.trigger('click')
    await nextTick()
    expect(localStorage.getItem('mockCSSEnabled')).toBe('true')
    expect(localStorage.getItem('mockMacroCount')).toBe('120')
    expect(localStorage.getItem('mockSpacePaid')).toBe('false')
    expect(reload).toHaveBeenCalledOnce()
  })
})
