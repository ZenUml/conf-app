import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import ConnectButton from './ConnectButton.vue'

describe('ConnectButton', () => {
  it('click emits connect', async () => {
    const wrapper = mount(ConnectButton)

    await wrapper.find('[data-testid="agent-link-connect-btn"]').trigger('click')

    expect(wrapper.emitted('connect')).toHaveLength(1)
  })

  // The viewer header can collapse the label to the icon when the macro is narrow
  // (GenericViewer.vue, responsive header); the button must keep its name without it.
  it('keeps an accessible name and tooltip when its label is hidden', () => {
    const button = mount(ConnectButton).find('[data-testid="agent-link-connect-btn"]')
    expect(button.attributes('aria-label')).toBe('Connect to Agent')
    expect(button.attributes('title')).toBe('Connect to Agent')
    expect(button.find('.agent-link-connect-btn__label').text()).toBe('Connect to Agent')
  })

  // lite-stg, 2026-10-02: squeezed to 121px in a 556px viewer, the label wrapped to two lines.
  it('never wraps its label', () => {
    const source = readFileSync(resolve(__dirname, './ConnectButton.vue'), 'utf-8')
    expect(source).toMatch(/\.agent-link-connect-btn \{[^}]*white-space: nowrap;/)
  })
})
