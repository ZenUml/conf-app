import {flushPromises, mount} from '@vue/test-utils'
import Header from '@/components/Header/Header.vue'
import {DiagramType} from "@/model/Diagram/Diagram";
import store from "@/model/store2/";
import { isAiChatEnabled, isAiTitleEnabled } from '@/apis/aiFeatureFlags'

vi.mock('@/apis/aiFeatureFlags', () => ({
  isAiChatEnabled: vi.fn().mockResolvedValue(true),
  isAiTitleEnabled: vi.fn().mockResolvedValue(true),
}))

describe('Header', () => {
  beforeEach(() => {
    store.commit('updateDiagramType', DiagramType.Sequence)
    vi.mocked(isAiChatEnabled).mockResolvedValue(true)
    vi.mocked(isAiTitleEnabled).mockResolvedValue(true)
  })

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

  it('emits the AI chat toggle action', async () => {
    const headerWrapper = mount(Header, {
      props: {
        aiChatOpen: true,
      },
      global: {
        plugins: [store]
      }
    })
    await flushPromises()

    const toggle = headerWrapper.get('[data-testid="ai-chat-toggle"]')
    expect(toggle.classes()).toContain('bg-violet-100')

    await toggle.trigger('click')

    expect(headerWrapper.emitted('toggle-ai-chat')).toHaveLength(1)
  })

  it('hides AI chat when the AI feature flag is disabled', async () => {
    vi.mocked(isAiChatEnabled).mockResolvedValue(false)

    const headerWrapper = mount(Header, {
      global: {
        plugins: [store]
      }
    })
    await flushPromises()

    expect(headerWrapper.find('[data-testid="ai-chat-toggle"]').exists()).toBe(false)
  })

  it('hides AI chat for Graph diagrams', async () => {
    store.commit('updateDiagramType', DiagramType.Graph)

    const headerWrapper = mount(Header, {
      global: {
        plugins: [store]
      }
    })
    await flushPromises()

    expect(headerWrapper.find('[data-testid="ai-chat-toggle"]').exists()).toBe(false)
  })
})
