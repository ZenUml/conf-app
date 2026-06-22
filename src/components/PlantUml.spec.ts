import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';

const validateMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/plantuml/validate', () => ({ validatePlantUmlSyntax: validateMock.fn }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: vi.fn() }));

describe('PlantUml.vue — reuses validated SVG, renders the first view immediately', () => {
  let wrapper: VueWrapper | undefined;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.diagram = { ...NULL_DIAGRAM };
    (globals as any).apWrapper = {
      initializeContext: vi.fn().mockResolvedValue(undefined),
      isDisplayMode: () => true,
    };
    fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, text: () => Promise.resolve('<svg>FETCHED</svg>') } as Response);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    fetchSpy.mockRestore();
  });

  it('renders the validator-provided SVG on mount without the 500ms debounce or a 2nd fetch', async () => {
    validateMock.fn.mockResolvedValue({ valid: true, error: null, svg: '<svg>VALIDATED</svg>' });
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.PlantUml,
      plantUmlCode: '@startuml\nA -> B\n@enduml',
    };
    wrapper = mount(PlantUml, { global: { plugins: [store] } });
    // No fake-timer advance: the initial view must render immediately (debounce is
    // for live edits only), so flushing microtasks is enough.
    await flushPromises();

    expect(wrapper.html()).toContain('VALIDATED');
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('plantuml'));
  });
});
