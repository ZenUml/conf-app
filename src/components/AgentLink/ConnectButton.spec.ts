import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectButton from './ConnectButton.vue'

describe('ConnectButton', () => {
  it('click emits connect', async () => {
    const wrapper = mount(ConnectButton)

    await wrapper.find('[data-testid="agent-link-connect-btn"]').trigger('click')

    expect(wrapper.emitted('connect')).toHaveLength(1)
  })
})
