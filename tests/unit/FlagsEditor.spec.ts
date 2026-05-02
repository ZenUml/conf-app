import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { MOCK_KEYS } from '@/components/Debug/presets'
import FlagsEditor from '@/components/Debug/FlagsEditor.vue'

const reload = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  for (const k of MOCK_KEYS) localStorage.removeItem(k)
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    configurable: true,
  })
})

describe('FlagsEditor', () => {
  it('Save writes booleans and numbers correctly', async () => {
    const wrapper = mount(FlagsEditor)
    await wrapper.get('[data-testid="edit-mockCSSEnabled"]').setValue('true')
    // Uncheck "unset" to enable the number input
    const macroCountUnset = wrapper.findAll('input[type="checkbox"]').find((w) => {
      const row = w.element.closest('tr')
      return row?.textContent?.includes('mockMacroCount')
    })!
    await macroCountUnset.setValue(false)
    await wrapper.get('[data-testid="edit-mockMacroCount"]').setValue('120')
    await wrapper.get('[data-testid="editor-save"]').trigger('click')
    await nextTick()
    expect(localStorage.getItem('mockCSSEnabled')).toBe('true')
    expect(localStorage.getItem('mockMacroCount')).toBe('120')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('Setting a boolean to "unset" deletes the key', async () => {
    localStorage.setItem('mockCSSEnabled', 'true')
    const wrapper = mount(FlagsEditor)
    await wrapper.get('[data-testid="edit-mockCSSEnabled"]').setValue('unset')
    await wrapper.get('[data-testid="editor-save"]').trigger('click')
    expect(localStorage.getItem('mockCSSEnabled')).toBeNull()
  })

  it('Negative number disables Save and shows an error', async () => {
    const wrapper = mount(FlagsEditor)
    const macroCountUnset = wrapper.findAll('input[type="checkbox"]').find((w) => {
      const row = w.element.closest('tr')
      return row?.textContent?.includes('mockMacroCount')
    })!
    await macroCountUnset.setValue(false)
    await wrapper.get('[data-testid="edit-mockMacroCount"]').setValue('-5')
    expect(wrapper.find('[data-testid="editor-error-mockMacroCount"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="editor-save"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('toggling unset off then setting a value writes it on Save', async () => {
    const wrapper = mount(FlagsEditor)
    const macroCountUnset = wrapper.findAll('input[type="checkbox"]').find((w) => {
      const row = w.element.closest('tr')
      return row?.textContent?.includes('mockMacroCount')
    })!
    await macroCountUnset.setValue(false)
    await wrapper.get('[data-testid="edit-mockMacroCount"]').setValue('42')
    await wrapper.get('[data-testid="editor-save"]').trigger('click')
    expect(localStorage.getItem('mockMacroCount')).toBe('42')
  })

  it('Cancel emits cancel without writing or reloading', async () => {
    const wrapper = mount(FlagsEditor)
    await wrapper.get('[data-testid="edit-mockCSSEnabled"]').setValue('true')
    await wrapper.get('[data-testid="editor-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(localStorage.getItem('mockCSSEnabled')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })
})
