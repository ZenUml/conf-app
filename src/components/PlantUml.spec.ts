import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import { getCachedSvg, putCachedSvg } from '@/utils/renderCache/renderCacheStore';

const validateMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/plantuml/validate', () => ({ validatePlantUmlSyntax: validateMock.fn }));
const trackRenderMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackRenderMock.fn }));
const trackEventMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: trackEventMock.fn }));

describe('PlantUml.vue — reuses validated SVG, renders the first view immediately', () => {
  let wrapper: VueWrapper | undefined;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); // isolate the back-catalog view cache between tests
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

describe('PlantUml.vue — back-catalog localStorage view cache', () => {
  let wrapper: VueWrapper | undefined;
  let fetchSpy: any;
  const CODE = '@startuml\nA -> B\n@enduml';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

  it('cache hit: injects the cached SVG and SKIPS validation + the plantuml.com fetch', async () => {
    putCachedSvg(CODE, '<svg xmlns="http://www.w3.org/2000/svg"><text>LS_PUML</text></svg>');
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: CODE };
    wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await flushPromises();

    expect(wrapper.html()).toContain('LS_PUML');
    expect(validateMock.fn).not.toHaveBeenCalled(); // no validation round-trip
    expect(fetchSpy).not.toHaveBeenCalled(); // no render round-trip
    expect(trackRenderMock.fn).toHaveBeenCalledWith('plantuml', expect.anything(), 'cached_svg', 'localstorage');
  });

  it('cc_body hit (cross-user): injects the body SVG, skips validation, fetch, AND localStorage', async () => {
    putCachedSvg(CODE, '<svg id="ls"><text>LS_PUML</text></svg>'); // localStorage also present
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.PlantUml,
      plantUmlCode: CODE,
      plantUmlSvg: '<svg id="cc" xmlns="http://www.w3.org/2000/svg"><text>CC_PUML</text></svg>',
    };
    wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await flushPromises();

    expect(wrapper.html()).toContain('CC_PUML');
    expect(wrapper.html()).not.toContain('LS_PUML'); // cc_body wins over localStorage
    expect(validateMock.fn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(trackRenderMock.fn).toHaveBeenCalledWith('plantuml', expect.anything(), 'cached_svg', 'cc_body');
  });

  it('live render warms the cache (render_cache_write persisted) for the next view', async () => {
    validateMock.fn.mockResolvedValue({ valid: true, error: null, svg: '<svg>VALIDATED</svg>' });
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: CODE };
    wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await flushPromises();

    expect(getCachedSvg(CODE)).toBe('<svg>VALIDATED</svg>'); // warmed for next view
    expect(trackEventMock.fn).toHaveBeenCalledWith(
      'render_cache_write',
      expect.objectContaining({ macro_type: 'plantuml', render_cache_outcome: 'persisted' }),
    );
    expect(trackRenderMock.fn).toHaveBeenCalledWith('plantuml', expect.anything(), 'live_render', 'none');
  });
});
