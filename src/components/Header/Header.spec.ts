import {mount} from '@vue/test-utils'
import {vi} from 'vitest'
import Header from '@/components/Header/Header.vue'
import {DiagramType} from "@/model/Diagram/Diagram";
import {getTemplatesForType} from "@/model/Diagram/EditorTemplates";
import store from "@/model/store2/";

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))
import {trackAnalyticsEvent} from '@/utils/analytics/trackAnalyticsEvent'

describe('Header', () => {
  it('should render correctly', async () => {
    store.commit('updateDiagramType', DiagramType.Sequence);
    const headerWrapper = mount(Header, {
      global: {
        plugins: [store]
      }
    })

    // Find tab buttons through TabSwitcher component
    const tabButtons = headerWrapper.findAll('.tab-switcher button');
    expect(tabButtons).toHaveLength(3);

    const sequenceButton = tabButtons[0];
    const mermaidButton = tabButtons[1];

    // pre-condition - sequence tab should be active (amber filled-tint style)
    expect(sequenceButton.classes()).toContain('bg-amber-100');
    expect(sequenceButton.classes()).toContain('text-amber-800');
    expect(mermaidButton.classes()).not.toContain('bg-emerald-100');

    // click to switch to mermaid
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    await mermaidButton.trigger('click');
    await headerWrapper.vm.$nextTick()

    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(mermaidButton.classes()).toContain('bg-emerald-100');
    expect(mermaidButton.classes()).toContain('text-emerald-800');
  })
})

describe('Header — starter-template gallery (#334)', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    store.commit('updateDiagramType', DiagramType.Sequence);
    store.state.diagram.id = '';
    store.state.diagram.code = '';
  })

  it('opens the gallery and fires editor_template_gallery_opened for a new macro', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } })

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)

    const templatesButton = wrapper.findAll('button').find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_template_gallery_opened', expect.objectContaining({
      feature_area: 'macro',
      surface: 'editor',
      macro_type: DiagramType.Sequence,
      is_new_macro: true,
    }))
  })

  it('applying a template writes its DSL into the store code field, fires editor_template_applied, and closes the gallery', async () => {
    store.state.diagram.id = 'existing-cc-id' // editing an existing macro -> is_new_macro: false
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const buttons = wrapper.findAll('button')
    const templatesButton = buttons.find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    const templates = getTemplatesForType(DiagramType.Sequence)
    const useButtons = wrapper.findAll('[data-testid="template-use-button"]')
    expect(useButtons.length).toBe(templates.length)

    await useButtons[0].trigger('click')

    expect(store.state.diagram.code).toBe(templates[0].dsl)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_template_applied', expect.objectContaining({
      feature_area: 'macro',
      surface: 'editor',
      template_id: templates[0].id,
      macro_type: DiagramType.Sequence,
      is_new_macro: false,
    }))

    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)
  })

  it('applying a mermaid template writes to mermaidCode, not code', async () => {
    store.commit('updateDiagramType', DiagramType.Mermaid)
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const buttons = wrapper.findAll('button')
    const templatesButton = buttons.find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    const templates = getTemplatesForType(DiagramType.Mermaid)
    const useButtons = wrapper.findAll('[data-testid="template-use-button"]')
    await useButtons[0].trigger('click')

    expect(store.state.diagram.mermaidCode).toBe(templates[0].dsl)
  })

  it('closing the gallery does not touch the store or fire editor_template_applied', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const buttons = wrapper.findAll('button')
    const templatesButton = buttons.find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    await wrapper.find('[data-testid="template-gallery-close"]').trigger('click')

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)
    expect(store.state.diagram.code).toBe('')
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('editor_template_applied', expect.anything())
  })

  it('closes the gallery if diagramType changes while it is open (no focus trap on the overlay)', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const templatesButton = wrapper.findAll('button').find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')
    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(true)

    store.commit('updateDiagramType', DiagramType.Mermaid)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)
  })
})
