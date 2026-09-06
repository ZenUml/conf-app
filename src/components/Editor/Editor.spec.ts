import { shallowMount } from '@vue/test-utils'
import Editor from '@/components/Editor/Editor.vue'
import store from "@/model/store2";
import {DiagramType} from "@/model/Diagram/Diagram";
import Example from "@/utils/sequence/Example";
import {vi} from "vitest";

const validationMocks = vi.hoisted(() => ({
  mermaid: vi.fn(),
  plantUml: vi.fn(),
  sequence: vi.fn(),
}));

vi.mock('@/utils/mermaid/validate', () => ({
  validateMermaidSyntax: validationMocks.mermaid,
}));
vi.mock('@/utils/plantuml/validate', () => ({
  validatePlantUmlSyntax: validationMocks.plantUml,
}));
vi.mock('@/utils/sequence/validate', () => ({
  validateSequenceSyntax: validationMocks.sequence,
}));

// The following code solves "TypeError: range(...).getBoundingClientRect is not a function"
document.createRange = () => {
  const range = new Range();

  range.getBoundingClientRect = vi.fn();

  range.getClientRects = () => {
    return {
      item: () => null,
      length: 0,
      [Symbol.iterator]: vi.fn()
    };
  };
  return range;
}
describe('Editor', () => {
  beforeEach(() => {
    store.commit('updateDiagramType', DiagramType.Sequence);
    store.commit('updateCode2', '');
    store.commit('updateError', null);
    validationMocks.mermaid.mockReset().mockResolvedValue({ valid: true, error: null, location: null });
    validationMocks.plantUml.mockReset().mockResolvedValue({ valid: true, error: null, location: null });
    validationMocks.sequence.mockReset().mockResolvedValue({ valid: true, error: null, location: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render correctly', () => {
    const editorWrapper = shallowMount(Editor, {
      global: {
        plugins: [store]
      }
    })
    const vm = editorWrapper.vm as any;
    expect(vm.code).toBe("");
    store.commit('updateDiagramType', DiagramType.Mermaid);
    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    store.commit('updateMermaidCode', Example.Mermaid);
    expect(vm.code).toBe(Example.Mermaid);
  })

  it('ignores a stale async validation result after the code changes', async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: any) => void;
    let resolveLatest!: (value: any) => void;
    const oldValidation = new Promise((resolve) => { resolveOld = resolve; });
    const latestValidation = new Promise((resolve) => { resolveLatest = resolve; });
    validationMocks.sequence
      .mockImplementationOnce(() => oldValidation)
      .mockImplementationOnce(() => latestValidation);

    store.commit('updateCode2', 'A.method( {');
    const wrapper = shallowMount(Editor, { global: { plugins: [store] } });
    vi.advanceTimersByTime(1_000);
    expect(validationMocks.sequence).toHaveBeenCalledWith('A.method( {');

    store.commit('updateError', 'Old syntax error');
    store.commit('updateCode2', 'A.method()');
    await wrapper.vm.$nextTick();
    expect(store.state.error).toBeNull();
    vi.advanceTimersByTime(1_000);

    resolveLatest({ valid: true, error: null, location: null });
    await Promise.resolve();
    resolveOld({ valid: false, error: 'Old syntax error', location: null });
    await Promise.resolve();

    expect(store.state.error).toBeNull();
    wrapper.unmount();
  });
})
