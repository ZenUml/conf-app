import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

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
});
