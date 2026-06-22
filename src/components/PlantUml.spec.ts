import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';

const validateMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/plantuml/validate', () => ({ validatePlantUmlSyntax: validateMock.fn }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: vi.fn() }));

describe('PlantUml.vue — reuses the validated SVG (no duplicate fetch)', () => {
  let wrapper: VueWrapper | undefined;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('renders the validator-provided SVG and never re-fetches the PlantUML server', async () => {
    validateMock.fn.mockResolvedValue({ valid: true, error: null, svg: '<svg>VALIDATED</svg>' });
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.PlantUml,
      plantUmlCode: '@startuml\nA -> B\n@enduml',
    };
    wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await flushPromises(); // mounted → validateAndRender → schedules the 500ms debounce
    await vi.advanceTimersByTimeAsync(600); // fire the debounce → fetchSvg
    await flushPromises();

    expect(wrapper.html()).toContain('VALIDATED');
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('plantuml'));
  });
});
