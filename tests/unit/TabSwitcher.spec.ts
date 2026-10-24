import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TabSwitcher from '@/components/TabSwitcher/TabSwitcher.vue'

const OPTIONS = [
  { value: 'sequence', label: 'Sequence' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'plantuml', label: 'PlantUML' },
]

describe('TabSwitcher', () => {
  it('shows the type accent underline on the selected tab only', () => {
    const wrapper = mount(TabSwitcher, {
      props: { modelValue: 'sequence', options: OPTIONS },
    })
    const sequence = wrapper.findAll('button')[0]
    const mermaid = wrapper.findAll('button')[1]

    expect(sequence.classes()).toContain('after:bg-[#0094D9]')
    expect(mermaid.classes()).not.toContain('after:bg-[#FF3670]')
  })

  // Fail if inactive tabs keep generic gray hover instead of per-type accent.
  it('uses each tab type accent for hover highlight on inactive tabs', () => {
    const wrapper = mount(TabSwitcher, {
      props: { modelValue: 'sequence', options: OPTIONS },
    })
    const mermaid = wrapper.findAll('button')[1]

    expect(mermaid.classes()).toContain('hover:text-[#FF3670]')
    expect(mermaid.classes()).not.toContain('hover:text-gray-900')
  })

  it('switches underline accent when selection changes', async () => {
    const wrapper = mount(TabSwitcher, {
      props: { modelValue: 'sequence', options: OPTIONS },
    })
    const mermaid = wrapper.findAll('button')[1]

    await mermaid.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['mermaid'])
  })
})
