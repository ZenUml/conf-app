import {mount} from '@vue/test-utils'
import Header from '@/components/Header/Header.vue'
import {DiagramType} from "@/model/Diagram/Diagram";
import store from "@/model/store2/";

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
