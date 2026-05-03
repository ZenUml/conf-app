import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { MOCK_KEYS } from '@/components/Debug/presets'
import FlagsStatusTable from '@/components/Debug/FlagsStatusTable.vue'

beforeEach(() => {
  for (const k of MOCK_KEYS) localStorage.removeItem(k)
})

describe('FlagsStatusTable', () => {
  it('renders one row per mock key', () => {
    const wrapper = mount(FlagsStatusTable)
    expect(wrapper.findAll('[data-testid="flag-row"]')).toHaveLength(MOCK_KEYS.length)
  })

  it('shows "—" for keys not set in localStorage', () => {
    const wrapper = mount(FlagsStatusTable)
    const macroCountRow = wrapper.find('[data-testid="flag-row"][data-key="mockMacroCount"]')
    expect(macroCountRow.get('[data-testid="flag-value"]').text()).toBe('—')
  })

  it('shows the stored value when set', () => {
    localStorage.setItem('mockMacroCount', '120')
    localStorage.setItem('mockCSSEnabled', 'true')
    const wrapper = mount(FlagsStatusTable)
    expect(wrapper.find('[data-testid="flag-row"][data-key="mockMacroCount"] [data-testid="flag-value"]').text()).toBe('120')
    expect(wrapper.find('[data-testid="flag-row"][data-key="mockCSSEnabled"] [data-testid="flag-value"]').text()).toBe('true')
  })
})
