import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import Header from '@/components/Header/Header.vue';
import EventBus from '@/EventBus';
import { DiagramType } from '@/model/Diagram/Diagram';
import extendedStore from '@/model/store2/ExtendedStore';
import { trackEvent } from '@/utils/window';

vi.mock('@/utils/window', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/window')>(),
  trackEvent: vi.fn(),
}));
vi.mock('@/apis/aiTitleFeatureFlag', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/apis/aiTitleFeatureFlag')>(),
  isAiChatEnabled: vi.fn().mockResolvedValue(false),
}));

function makeStore(diagramType: DiagramType, initialCode: string) {
  return createStore({
    ...extendedStore,
    state: {
      ...extendedStore.state,
      diagram: {
        id: 'existing-diagram',
        title: 'Test diagram',
        diagramType,
        code: diagramType === DiagramType.Sequence ? initialCode : '',
        mermaidCode: diagramType === DiagramType.Mermaid ? initialCode : '',
        isNew: false,
      },
    } as any,
  });
}

describe('Header exit change detection', () => {
  const wrappers: Array<ReturnType<typeof mount>> = [];
  let emit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(trackEvent).mockClear();
    emit = vi.spyOn(EventBus, '$emit').mockImplementation(() => undefined);
  });

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    emit.mockRestore();
  });

  it.each([
    ['sequence code', DiagramType.Sequence, 'code'],
    ['Mermaid code', DiagramType.Mermaid, 'mermaidCode'],
  ] as const)('reports unchanged and changed %s from the mounted editor', async (_label, diagramType, field) => {
    const store = makeStore(diagramType, 'original');
    const wrapper = mount(Header, { global: { plugins: [store] } });
    wrappers.push(wrapper);
    await flushPromises();

    (wrapper.vm as any).exit();
    expect(emit).toHaveBeenLastCalledWith('exit', false);
    expect(trackEvent).toHaveBeenLastCalledWith(
      '',
      'before_edit_macro_exit',
      diagramType,
      expect.objectContaining({ had_changes: false }),
    );

    store.state.diagram[field] = 'edited';
    await wrapper.vm.$nextTick();
    (wrapper.vm as any).exit();
    expect(emit).toHaveBeenLastCalledWith('exit', true);
    expect(trackEvent).toHaveBeenLastCalledWith(
      '',
      'before_edit_macro_exit',
      diagramType,
      expect.objectContaining({ had_changes: true }),
    );
  });

  it('normalizes an absent code buffer to the original empty buffer', async () => {
    const store = makeStore(DiagramType.Sequence, '');
    const wrapper = mount(Header, { global: { plugins: [store] } });
    wrappers.push(wrapper);
    await flushPromises();

    store.state.diagram.code = undefined as any;
    await wrapper.vm.$nextTick();
    (wrapper.vm as any).exit();

    expect(emit).toHaveBeenLastCalledWith('exit', false);
  });
});
