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
    expect(tabButtons).toHaveLength(2);

    const sequenceButton = tabButtons[0];
    const mermaidButton = tabButtons[1];

    // pre-condition - sequence tab should be active (secondary style)
    expect(sequenceButton.classes()).toContain('border-2');
    expect(sequenceButton.classes()).toContain('border-blue-600');
    expect(sequenceButton.classes()).toContain('text-blue-600');
    expect(mermaidButton.classes()).not.toContain('border-blue-600');

    // click to switch to mermaid
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    await mermaidButton.trigger('click');
    await headerWrapper.vm.$nextTick()

    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(mermaidButton.classes()).toContain('border-2');
    expect(mermaidButton.classes()).toContain('border-blue-600');
    expect(mermaidButton.classes()).toContain('text-blue-600');
  })
})
