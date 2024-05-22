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
    // pre-condition
    const sequenceButton = headerWrapper.find('#btn-sequence');
    expect(sequenceButton.classes('bg-white')).toBeTruthy();
    const mermaidButton = headerWrapper.find('#btn-mermaid');
    expect(mermaidButton.classes('bg-white')).toBeFalsy();

    // click to switch to mermaid
    // @ts-ignore
    expect(headerWrapper.vm.$store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    await mermaidButton.trigger('click');
    await headerWrapper.vm.$nextTick()

    // @ts-ignore
    expect(headerWrapper.vm.$store.state.diagram.diagramType).toBe(DiagramType.Mermaid);

    await new Promise(resolve =>
      setTimeout(() => {
        expect(mermaidButton.classes("bg-white")).toBeTruthy();
        resolve(true);
      }, 500)
    );
  })
})
