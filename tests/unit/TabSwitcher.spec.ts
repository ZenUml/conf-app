import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TabSwitcher from '@/components/TabSwitcher/TabSwitcher.vue'

const OPTIONS = [
  { value: 'sequence', label: 'Sequence' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'plantuml', label: 'PlantUML' },
]

describe('TabSwitcher', () => {
  it('shows the selected type with the notch’s bold metrics and no duplicate underline', () => {
    const wrapper = mount(TabSwitcher, {
      props: { modelValue: 'sequence', options: OPTIONS },
    })
    const sequence = wrapper.findAll('button')[0]
    const mermaid = wrapper.findAll('button')[1]

    expect(sequence.classes()).toContain('font-semibold')
    expect(sequence.classes()).not.toContain('after:bg-[#0094D9]')
    expect(mermaid.classes()).toContain('font-medium')
  })

  // Fail if inactive tabs keep generic gray hover instead of per-type accent.
  it('keeps inactive tabs neutral until selection', () => {
    const wrapper = mount(TabSwitcher, {
      props: { modelValue: 'sequence', options: OPTIONS },
    })
    const mermaid = wrapper.findAll('button')[1]

    expect(mermaid.classes()).toContain('text-gray-500')
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
