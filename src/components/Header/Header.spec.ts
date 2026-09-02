import {mount, flushPromises, enableAutoUnmount} from '@vue/test-utils'
import {afterEach, vi} from 'vitest'
import Header from '@/components/Header/Header.vue'
import {DiagramType} from "@/model/Diagram/Diagram";
import {getTemplatesForType} from "@/model/Diagram/EditorTemplates";
import store from "@/model/store2/";
import Example from "@/utils/sequence/Example";

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))
vi.mock('@/apis/aiTitleFeatureFlag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/apis/aiTitleFeatureFlag')>()
  return { ...actual, isAiChatEnabled: vi.fn().mockResolvedValue(true) }
})
import {trackAnalyticsEvent} from '@/utils/analytics/trackAnalyticsEvent'
import {isAiChatEnabled} from '@/apis/aiTitleFeatureFlag'

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.mocked(isAiChatEnabled).mockResolvedValue(true)
  vi.mocked(trackAnalyticsEvent).mockClear()
})

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

    // Sequence tab starts selected with its accent underline.
    expect(sequenceButton.classes()).toContain('after:bg-[#0094D9]')
    expect(sequenceButton.classes()).toContain('text-[#054E76]')
    expect(mermaidButton.classes()).not.toContain('after:bg-[#FF3670]')

    // click to switch to mermaid
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    await mermaidButton.trigger('click');
    await headerWrapper.vm.$nextTick()

    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(mermaidButton.classes()).toContain('after:bg-[#FF3670]')
    expect(mermaidButton.classes()).toContain('text-[#8E0F33]')
  })

  it('shows the independently flagged AI Chat action and emits toggle', async () => {
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.isNew = false
    const wrapper = mount(Header, {
      props: { aiChatOpen: true },
      global: { plugins: [store] },
    })
    await flushPromises()

    const toggle = wrapper.get('[data-testid="ai-chat-toggle"]')
    expect(toggle.classes()).toContain('bg-violet-100')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_chat_button_shown', {
      feature_area: 'ai',
      surface: 'editor',
      macro_type: DiagramType.Sequence,
    })
    await toggle.trigger('click')

    expect(wrapper.emitted('toggle-ai-chat')).toHaveLength(1)
  })

  it('tracks each AI Chat button visibility transition without counting re-renders', async () => {
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.isNew = false
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await flushPromises()

    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'ai_chat_button_shown')).toHaveLength(1)
    await wrapper.vm.$forceUpdate()
    await wrapper.vm.$nextTick()
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'ai_chat_button_shown')).toHaveLength(1)

    store.commit('updateDiagramType', DiagramType.Graph)
    await wrapper.vm.$nextTick()
    store.commit('updateDiagramType', DiagramType.Mermaid)
    await wrapper.vm.$nextTick()
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'ai_chat_button_shown')).toHaveLength(2)
  })

  it('hides AI Chat when its feature flag is disabled', async () => {
    vi.mocked(isAiChatEnabled).mockResolvedValue(false)
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.isNew = false
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="ai-chat-toggle"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_chat_button_shown', expect.anything())
  })

  it('hides AI Chat for Graph diagrams', async () => {
    store.commit('updateDiagramType', DiagramType.Graph)
    store.state.diagram.isNew = false
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="ai-chat-toggle"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_chat_button_shown', expect.anything())
  })

  describe('the remembered diagram type', () => {
    function mountWith(diagram: Record<string, unknown>) {
      store.state.diagram = { ...store.state.diagram, ...diagram } as any;
      return mount(Header, { global: { plugins: [store] } });
    }

    afterEach(() => localStorage.removeItem('zenuml-preferred-diagram-type'));

    it('still applies to a new diagram nobody asked a type for', async () => {
      localStorage.setItem('zenuml-preferred-diagram-type', DiagramType.Mermaid);
      const w = mountWith({ isNew: true, typeRequested: false, diagramType: DiagramType.Sequence });
      await w.vm.$nextTick();

      expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    });

    it('never overrules a type the user just picked', async () => {
      // The byline's picker (and a pasted /new/<type> link) seed the doc and set
      // typeRequested. Without this guard the preference won, so choosing
      // Flowchart opened a Sequence editor for anyone whose last diagram was a
      // sequence — which is most people.
      localStorage.setItem('zenuml-preferred-diagram-type', DiagramType.Sequence);
      const w = mountWith({ isNew: true, typeRequested: true, diagramType: DiagramType.Mermaid });
      await w.vm.$nextTick();

      expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    });
  })
})

describe('Header — macro_type_changed telemetry (#562)', () => {
  beforeEach(async () => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    localStorage.removeItem('zenuml-preferred-diagram-type');
    store.state.diagram = {
      ...store.state.diagram,
      id: '',
      isNew: true,
      typeRequested: true,
      title: 'Telemetry test',
      diagramType: DiagramType.Sequence,
      code: 'Alice->Bob: hello',
      mermaidCode: '',
      plantUmlCode: '',
    } as any;
    await flushPromises();
    store.commit('updateDiagramType', DiagramType.Sequence);
  });

  it('reports the observed new-macro Sequence → Mermaid tab switch', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } });
    const mermaidButton = wrapper.findAll('.tab-switcher button')[1];

    await mermaidButton.trigger('click');

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_type_changed', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: DiagramType.Mermaid,
      from_macro_type: DiagramType.Sequence,
      to_macro_type: DiagramType.Mermaid,
      operation_mode: 'create',
      type_requested: true,
      is_new_macro: true,
    });
  });

  it('does not report a type change when the active tab is selected again', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } });
    const sequenceButton = wrapper.findAll('.tab-switcher button')[0];

    await sequenceButton.trigger('click');

    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('macro_type_changed', expect.anything());
  });

  it('reports an existing-macro tab switch as edit mode', async () => {
    store.state.diagram.id = 'existing-custom-content-id';
    store.state.diagram.typeRequested = false;
    store.commit('updateDiagramType', DiagramType.Sequence);
    const wrapper = mount(Header, { global: { plugins: [store] } });
    const plantUmlButton = wrapper.findAll('.tab-switcher button')[2];

    await plantUmlButton.trigger('click');

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_type_changed', expect.objectContaining({
      macro_type: DiagramType.PlantUml,
      from_macro_type: DiagramType.Sequence,
      to_macro_type: DiagramType.PlantUml,
      operation_mode: 'edit',
      type_requested: false,
      is_new_macro: false,
    }));
  });

  it('reports each step of a multi-tab switch in order', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } });
    const [sequenceButton, mermaidButton, plantUmlButton] = wrapper.findAll('.tab-switcher button');

    await mermaidButton.trigger('click');
    await plantUmlButton.trigger('click');

    const changes = vi.mocked(trackAnalyticsEvent).mock.calls
      .filter(([eventName]) => eventName === 'macro_type_changed')
      .map(([, properties]) => [properties.from_macro_type, properties.to_macro_type]);
    expect(changes).toEqual([
      [DiagramType.Sequence, DiagramType.Mermaid],
      [DiagramType.Mermaid, DiagramType.PlantUml],
    ]);
    expect(sequenceButton.attributes('aria-selected')).toBe('false');
  });
});

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
      template_gallery_trigger: 'manual',
    }))
  })

  it('fires editor_starter_shown once when the gallery opens on an empty new macro', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const templatesButton = wrapper.findAll('button').find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_starter_shown', expect.objectContaining({
      feature_area: 'macro',
      surface: 'editor',
      macro_type: DiagramType.Sequence,
      entry_point: 'macro_toolbar',
      trigger: 'manual',
    }))
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(c => c[0] === 'editor_starter_shown')).toHaveLength(1)
  })

  it('does not fire editor_starter_shown when opening the gallery for an existing macro', async () => {
    store.state.diagram.id = 'existing-cc-id'
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const templatesButton = wrapper.findAll('button').find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('editor_starter_shown', expect.anything())
  })

  it('does not fire editor_starter_shown when a new macro already has code (e.g. a restored draft)', async () => {
    store.state.diagram.code = 'A->B: hi'
    const wrapper = mount(Header, { global: { plugins: [store] } })

    const templatesButton = wrapper.findAll('button').find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('editor_starter_shown', expect.anything())
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

describe('Header — starter-template gallery auto-open (onboarding funnel)', () => {
  const AUTO_OPEN_KEY = 'zenuml.starterGalleryAutoOpened.test-cloud.sequence'

  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.id = ''
    store.state.diagram.code = ''
    store.state.diagram.isNew = false
    localStorage.removeItem(AUTO_OPEN_KEY)
    localStorage.removeItem('zenuml.starterGalleryAutoOpened.test-cloud.mermaid')
  })

  afterEach(() => {
    localStorage.removeItem(AUTO_OPEN_KEY)
    localStorage.removeItem('zenuml.starterGalleryAutoOpened.test-cloud.mermaid')
  })

  it('opens the gallery exactly once on mount for an empty new macro', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_template_gallery_opened', expect.objectContaining({
      macro_type: DiagramType.Sequence,
      is_new_macro: true,
      template_gallery_trigger: 'auto_first_open',
    }))
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_starter_shown', expect.objectContaining({
      macro_type: DiagramType.Sequence,
      trigger: 'auto_first_open',
    }))
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(c => c[0] === 'editor_starter_shown')).toHaveLength(1)
    expect(localStorage.getItem(AUTO_OPEN_KEY)).toBe('1')
  })

  it('does not auto-open when the new macro already has code', async () => {
    store.state.diagram.code = 'A->B: hi'
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('editor_starter_shown', expect.anything())
  })

  // Regression for the 2026-08-18 overnight-run spot check: forgeIndex.ts's
  // real new-macro path never sets code to '' — it seeds Example.Sequence /
  // .Mermaid / .PlantUml with isNew: true (see forgeIndex.ts's fallback doc
  // construction). A store fixture with code: '' does not exercise that, so
  // this test reproduces the actual mounted-state shape a fresh Confluence
  // macro insert produces.
  it('auto-opens when the new macro still holds the untouched seed example (real forgeIndex.ts shape)', async () => {
    store.state.diagram.isNew = true
    store.state.diagram.code = Example.Sequence
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_starter_shown', expect.objectContaining({
      macro_type: DiagramType.Sequence,
      trigger: 'auto_first_open',
    }))
  })

  it('does not auto-open when editing an existing macro', async () => {
    store.state.diagram.id = 'existing-cc-id'
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('editor_starter_shown', expect.anything())
  })

  it('a second mount after dismissal does not re-open the gallery', async () => {
    const first = mount(Header, { global: { plugins: [store] } })
    await first.vm.$nextTick()
    await flushPromises()
    await first.vm.$nextTick()
    expect(first.find('[data-testid="template-gallery"]').exists()).toBe(true)

    await first.find('[data-testid="template-gallery-close"]').trigger('click')
    await first.vm.$nextTick()
    expect(first.find('[data-testid="template-gallery"]').exists()).toBe(false)
    first.unmount()

    vi.mocked(trackAnalyticsEvent).mockClear()
    const second = mount(Header, { global: { plugins: [store] } })
    await second.vm.$nextTick()
    await flushPromises()
    await second.vm.$nextTick()

    expect(second.find('[data-testid="template-gallery"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('editor_starter_shown', expect.anything())
  })

  it('the manual Templates button still reports trigger "manual" even after an auto-open marker exists', async () => {
    localStorage.setItem(AUTO_OPEN_KEY, '1')
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)

    vi.mocked(trackAnalyticsEvent).mockClear()
    const templatesButton = wrapper.findAll('button').find(b => b.text().includes('Templates'))!
    await templatesButton.trigger('click')

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_template_gallery_opened', expect.objectContaining({
      template_gallery_trigger: 'manual',
    }))
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_starter_shown', expect.objectContaining({
      trigger: 'manual',
      entry_point: 'macro_toolbar',
    }))
  })

  it('applying a template from the auto-opened gallery behaves identically to the manual path', async () => {
    const wrapper = mount(Header, { global: { plugins: [store] } })
    await wrapper.vm.$nextTick()
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(true)

    const templates = getTemplatesForType(DiagramType.Sequence)
    const useButtons = wrapper.findAll('[data-testid="template-use-button"]')
    await useButtons[0].trigger('click')

    expect(store.state.diagram.code).toBe(templates[0].dsl)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('editor_template_applied', expect.objectContaining({
      template_id: templates[0].id,
      macro_type: DiagramType.Sequence,
      is_new_macro: true,
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false)
  })
})
