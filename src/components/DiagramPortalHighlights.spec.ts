import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import { createStore } from 'vuex'
import DiagramPortal from './DiagramPortal.vue'
import { DiagramType } from '@/model/Diagram/Diagram'
const mountPortal = (type, props = {}) => mount(DiagramPortal, {
  props,
  global: {
    plugins: [createStore({ state: { diagram: { diagramType: type } } })],
    stubs: {
      MermaidHighlightViewer: { name: 'MermaidHighlightViewer', props: ['wide'], template: '<div class="highlight-viewer" />' },
      GenericViewer: { name: 'GenericViewer', props: ['wide', 'hideHeader'], template: '<div class="generic-viewer"><slot /></div>' },
      Mermaid: true, Sequence: { name: 'Sequence', props: ['autoResize', 'readOnly'], template: '<div />' },
      Markdown: true, PlantUml: true,
    },
  },
})
describe('DiagramPortal relationship highlight routing', () => {
  it('routes normal Mermaid viewers through the real composition and preserves wide', () => {
    const wrapper = mountPortal(DiagramType.Mermaid, { autoResize: true })
    expect(wrapper.findComponent({ name: 'MermaidHighlightViewer' }).props('wide')).toBe(true)
    expect(wrapper.find('.generic-viewer').exists()).toBe(false)
  })
  it.each([{ hideHeader: true }, { readOnly: true }])('keeps preview context %j on the existing viewer', props => {
    const wrapper = mountPortal(DiagramType.Mermaid, { ...props, autoResize: true })
    expect(wrapper.find('.highlight-viewer').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'GenericViewer' }).props()).toMatchObject({ wide: true, hideHeader: Boolean(props.hideHeader) })
    expect(wrapper.findComponent({ name: 'Mermaid' }).exists()).toBe(true)
  })
  it('preserves Sequence preview and autoResize props', () => {
    const wrapper = mountPortal(DiagramType.Sequence, { autoResize: true, readOnly: true })
    expect(wrapper.find('.highlight-viewer').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'Sequence' }).props()).toMatchObject({ autoResize: true, readOnly: true })
  })
})
