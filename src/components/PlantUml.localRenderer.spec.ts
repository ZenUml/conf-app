import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { renderPlantUmlLocally, PlantUmlLocalRenderError } from '@/utils/plantuml/engine';
import { PLANTUML_RENDERER_STORAGE_KEY, resetPlantUmlRendererForTests } from '@/utils/plantuml/renderer';
import { isPlantUmlLocalRendererEnabled } from '@/apis/aiTitleFeatureFlag';

// ADR-0010: with the local renderer chosen, the viewer draws with the
// in-browser engine and never contacts plantuml.com, unless the engine cannot
// draw the diagram, in which case it falls back to the server. The engine
// itself needs a real canvas, so it is mocked here; Storybook and a real Forge
// iframe exercise the real one.

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
      initializeContext: vi.fn(() => Promise.resolve()),
    },
  },
}));
vi.mock('lodash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lodash')>();
  return {
    ...actual,
    debounce: (fn: (...args: unknown[]) => unknown) =>
      Object.assign((...args: unknown[]) => fn(...args), { cancel: () => {} }),
  };
});
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isPlantUmlLocalRendererEnabled: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/utils/plantuml/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/plantuml/engine')>();
  return { ...actual, renderPlantUmlLocally: vi.fn() };
});
vi.mock('svg-pan-zoom', () => ({
  default: vi.fn(() => ({
    destroy: vi.fn(), disableDblClickZoom: vi.fn(), getPan: vi.fn(() => ({ x: 0, y: 0 })),
    getZoom: vi.fn(() => 1), pan: vi.fn(), reset: vi.fn(), resize: vi.fn(), zoom: vi.fn(),
    zoomIn: vi.fn(), zoomOut: vi.fn(),
  })),
}));
vi.mock('hammerjs', () => ({
  default: vi.fn(() => ({ destroy: vi.fn(), get: vi.fn(() => ({ set: vi.fn() })), on: vi.fn() })),
}));

// The shape @plantuml/core returns: a viewBox plus unit-less width/height.
const LOCAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 106 148" width="106" height="148">' +
  '<g><text x="10" y="20">Alice</text></g></svg>';

const CODE = '@startuml\nAlice -> Bob: local\n@enduml';

describe('PlantUml local renderer (ADR-0010)', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    resetPlantUmlRendererForTests();
    localStorage.setItem(PLANTUML_RENDERER_STORAGE_KEY, 'local');
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 106, height: 148 } as DOMRect);
    window.fetch = vi.fn(() => Promise.reject(new Error('no network in local mode'))) as typeof fetch;
    window.__macroLoadStart = 0;
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: CODE };
  });

  afterEach(() => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('draws the engine SVG without any fetch and reports plantuml_renderer=local', async () => {
    vi.mocked(renderPlantUmlLocally).mockResolvedValue(LOCAL_SVG);

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(wrapper.find('.plantuml-render svg').exists()).toBe(true));
    expect(wrapper.find('.plantuml-render svg').attributes('viewBox')).toBe('0 0 106 148');
    expect(window.fetch).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(true);
    });
    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'macro_viewed')!;
    expect(props).toMatchObject({ macro_type: 'plantuml', plantuml_renderer: 'local' });
  });

  it('falls back to the server when the engine cannot draw the diagram, and says so', async () => {
    vi.mocked(renderPlantUmlLocally).mockRejectedValue(
      new PlantUmlLocalRenderError('include', 'This diagram uses an !include library that is not available yet', 'stdlib'));
    window.fetch = vi.fn(() => Promise.resolve(new Response(LOCAL_SVG, { status: 200 }))) as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(wrapper.find('.plantuml-render svg').exists()).toBe(true));
    expect(wrapper.text()).not.toContain('Failed to render');
    expect(String(vi.mocked(window.fetch).mock.calls[0][0])).toContain('www.plantuml.com/plantuml/svg/');
    await vi.waitFor(() => {
      expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(true);
    });
    const [, viewed] = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'macro_viewed')!;
    expect(viewed).toMatchObject({ macro_type: 'plantuml', plantuml_renderer: 'server_fallback' });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('plantuml_local_render_failed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'plantuml',
      plantuml_renderer: 'local',
      plantuml_failure_reason: 'include',
      plantuml_unresolved_include: 'stdlib',
    });
  });

  it('uses the engine when the Forge flag is on, without any localStorage opt-in', async () => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
    vi.mocked(isPlantUmlLocalRendererEnabled).mockResolvedValueOnce(true);
    vi.mocked(renderPlantUmlLocally).mockResolvedValue(LOCAL_SVG);

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(wrapper.find('.plantuml-render svg').exists()).toBe(true));
    expect(renderPlantUmlLocally).toHaveBeenCalled();
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('keeps the server renderer when the flag is off and the viewer has not opted in', async () => {
    localStorage.removeItem(PLANTUML_RENDERER_STORAGE_KEY);
    window.fetch = vi.fn(() => Promise.resolve(new Response(LOCAL_SVG, { status: 200 }))) as typeof fetch;

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(wrapper.find('.plantuml-render svg').exists()).toBe(true));
    expect(renderPlantUmlLocally).not.toHaveBeenCalled();
    expect(String(vi.mocked(window.fetch).mock.calls[0][0])).toContain('www.plantuml.com/plantuml/svg/');
  });
});
