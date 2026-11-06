import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { clearPlantUmlSvgCache } from '@/utils/plantuml/server';

// Unlike PlantUml.spec.ts, this keeps the real validator: the point is that
// validate and render share one plantuml.com round trip (#929).

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

const SERVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="322px" height="243px" viewBox="0 0 322 243">' +
  '<g><text x="10" y="20">Alice</text></g></svg>';

describe('PlantUml validate + render (#929)', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    clearPlantUmlSvgCache();
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243,
    } as DOMRect);
    window.fetch = vi.fn(() => Promise.resolve(new Response(SERVER_SVG, { status: 200 }))) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the SVG from plantuml.com once for validation and render', async () => {
    const code = '@startuml\nAlice -> Bob: single fetch\n@enduml';
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: code };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(wrapper.find('.plantuml-render svg').exists()).toBe(true);
    });
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });
});
