import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { validatePlantUmlSyntax } from '@/utils/plantuml/validate';
import Example from '@/utils/sequence/Example';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
      initializeContext: vi.fn(() => Promise.resolve()),
    },
  },
}));

// The 500ms render debounce would otherwise make every assertion a timer dance.
vi.mock('lodash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lodash')>();
  return {
    ...actual,
    debounce: (fn: (...args: unknown[]) => unknown) =>
      Object.assign((...args: unknown[]) => fn(...args), { cancel: () => {} }),
  };
});

vi.mock('@/utils/plantuml/validate', () => ({
  validatePlantUmlSyntax: vi.fn(() => Promise.resolve({ valid: true, error: null, location: null })),
}));

const panZoomInstanceMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  disableDblClickZoom: vi.fn(),
  getPan: vi.fn(() => ({ x: 0, y: 0 })),
  getZoom: vi.fn(() => 1),
  pan: vi.fn(),
  reset: vi.fn(),
  resize: vi.fn(),
  zoom: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));
const svgPanZoomMock = vi.hoisted(() => vi.fn(() => panZoomInstanceMock));
vi.mock('svg-pan-zoom', () => ({ default: svgPanZoomMock }));

const hammerManagerMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  get: vi.fn(() => ({ set: vi.fn() })),
  on: vi.fn(),
}));
vi.mock('hammerjs', () => ({ default: vi.fn(() => hammerManagerMock) }));

// What the plantuml.com server actually returns — a fixed pixel size plus
// preserveAspectRatio="none". normalizePlantUmlSvg rewrites this into the
// viewBox-only shape the viewport depends on.
const SERVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="322px" height="243px" preserveAspectRatio="none"' +
  ' style="width:322px;height:243px;background:#FFFFFF;" viewBox="0 0 322 243" version="1.1">' +
  '<g><text x="10" y="20">Alice</text></g></svg>';

describe('PlantUml pan/zoom viewport', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validatePlantUmlSyntax).mockResolvedValue({ valid: true, error: null, location: null });
    // jsdom lays nothing out, and DiagramViewport refuses to attach to a 0 x 0
    // SVG (svg-pan-zoom would throw InvalidStateError on the singular matrix).
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243,
    } as DOMRect);
    window.fetch = vi.fn(() => Promise.resolve(new Response(SERVER_SVG, { status: 200 }))) as typeof fetch;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.PlantUml,
      plantUmlCode: '@startuml\nAlice -> Bob: Hello\n@enduml',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
  });

  it('attaches the shared viewport to the rendered SVG and labels the toolbar for PlantUML', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = { forgeContext: { extension: {} } };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(svgPanZoomMock).toHaveBeenCalled();
    });
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('PlantUML zoom controls');
    // captureCrop.ts and the export-entry framing rules both select this class.
    expect(wrapper.get('.diagram-viewport-content').classes()).toContain('plantuml-render');
  });

  it.each([
    ['authored', '@startuml\nAlice -> Bob: Hello\n@enduml', 'authored'],
    ['bundled example', Example.PlantUml, 'default'],
  ])('macro_viewed carries content_state for a %s body (#113)', async (_label, code, expected) => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = { forgeContext: { extension: {} } };
    window.__macroLoadStart = 0;
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: code };

    mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(true);
    });
    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'macro_viewed')!;
    expect(props).toMatchObject({ macro_type: 'plantuml', content_state: expected });
  });

  // #113: forgeIndex backfills an empty body with the example on the main load
  // path, but the embed viewer mounts the referenced document as stored, so a
  // wiped PlantUML body can reach this component. It reports the view with the
  // verdict and does not hit the render server.
  it('emits one macro_viewed with content_state=empty for a loaded empty body and does not fetch (#113)', async () => {
    window.__macroLoadStart = 0;
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: '' };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const viewed = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0][1]).toMatchObject({ macro_type: 'plantuml', content_state: 'empty' });
    expect(window.fetch).not.toHaveBeenCalled();

    // The body arriving later in the same mount must not be a second view.
    store.state.diagram = { ...store.state.diagram, plantUmlCode: '@startuml\nA -> B\n@enduml' };
    await vi.waitFor(() => expect(window.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed')).toHaveLength(1);
  });

  it('emits no macro_viewed for an empty PlantUML body that never loaded (#113)', async () => {
    window.__macroLoadStart = 0;
    store.state.diagram = { ...NULL_DIAGRAM };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(false);
  });

  it('reports viewport actions as plantuml', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = { forgeContext: { extension: {} } };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(svgPanZoomMock).toHaveBeenCalled());

    await wrapper.get('[aria-label="Zoom in"]').trigger('click');

    expect(panZoomInstanceMock.zoomIn).toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewport_control_used', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'plantuml',
      viewport_action: 'zoom_in',
      viewport_input: 'toolbar',
    });
  });

  it('leaves the Export PNG surface untouched', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen', openExport: true } } },
    };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(wrapper.find('.plantuml-render svg').exists()).toBe(true);
    });
    // A pan/zoom transform (and a floating toolbar) would end up in the capture.
    expect(svgPanZoomMock).not.toHaveBeenCalled();
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false);
  });

  it('keeps the viewBox the viewport measures from when normalising the server SVG', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = { forgeContext: { extension: {} } };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(wrapper.find('.plantuml-render svg').exists()).toBe(true));

    const svg = wrapper.get('.plantuml-render svg');
    // The fixed px size is what squashed the diagram in conf-app#626; the viewBox
    // is what DiagramViewport reads the inline aspect ratio from before
    // svg-pan-zoom removes it.
    expect(svg.attributes('viewBox') ?? svg.attributes('viewbox')).toBe('0 0 322 243');
    expect(svg.attributes('width')).toBeUndefined();
    expect(svg.attributes('height')).toBeUndefined();
  });

  it('offers a complete, copyable snippet in the empty state', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = { forgeContext: { extension: {} } };
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: '' };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(wrapper.find('pre').exists()).toBe(true));

    // Wrapping the template into `.plantuml-root` for the viewport dropped the
    // closing line here, and every spec still passed: the onboarding snippet is
    // static markup no other test reads. A user who copied it got an
    // unterminated block. Assert the shape rather than the exact text, so this
    // guards the class of regression and not one byte of copy.
    const snippet = wrapper.get('pre').text();
    expect(snippet.startsWith('@startuml')).toBe(true);
    expect(snippet.trimEnd().endsWith('@enduml')).toBe(true);
  });

  it('waits for layout instead of attaching to a 0 x 0 SVG', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = { forgeContext: { extension: {} } };
    // A Forge iframe can still be unlaid-out when the render lands; attaching
    // there inverts a singular screen matrix and throws InvalidStateError.
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0,
    } as DOMRect);

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(wrapper.find('.plantuml-render svg').exists()).toBe(true));

    expect(svgPanZoomMock).not.toHaveBeenCalled();
  });

  it('does not publish a PlantUML validation error after switching to Mermaid', async () => {
    let resolveValidation!: (result: any) => void;
    vi.mocked(validatePlantUmlSyntax).mockImplementationOnce(() => new Promise((resolve) => {
      resolveValidation = resolve;
    }));
    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    expect(validatePlantUmlSyntax).toHaveBeenCalled();

    store.commit('updateDiagramType', DiagramType.Mermaid);
    await wrapper.vm.$nextTick();
    resolveValidation({ valid: false, error: 'PlantUML syntax error at line 2: Assumed diagram type: sequence', location: null });
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(store.state.error).toBeNull();
  });
});
