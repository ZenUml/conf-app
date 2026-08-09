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
