import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { clearPlantUmlSvgCache } from '@/utils/plantuml/server';

// Unlike PlantUml.spec.ts and PlantUml.singleFetch.spec.ts this keeps the REAL
// lodash debounce and drives time with fake timers: the point is how long a
// viewer waits between "server SVG in hand" and "SVG on screen".
//
// First mount is a page view — nothing is being typed, so the 500 ms edit
// debounce only delays first paint. Edits in the editor must keep it.

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
      initializeContext: vi.fn(() => Promise.resolve()),
    },
  },
}));
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

// The server echoes the diagram's first message label so each render is
// distinguishable in the DOM.
function serverSvgFor(code: string): string {
  const label = /:\s*([^\n]+)/.exec(code)?.[1] ?? 'none';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="322px" height="243px" viewBox="0 0 322 243">' +
    `<g><text x="10" y="20">${label}</text></g></svg>`
  );
}

const CODE_A = '@startuml\nAlice -> Bob: first paint\n@enduml';
const CODE_B = '@startuml\nAlice -> Bob: edited\n@enduml';

// Settle the validate → render promise chain without touching the clock.
async function settleMicrotasks() {
  for (let i = 0; i < 10; i += 1) {
    await flushPromises();
  }
}

describe('PlantUml first-mount render timing', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    clearPlantUmlSvgCache();
    vi.useFakeTimers();
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243,
    } as DOMRect);
    // fetchPlantUmlSvg keys requests by the encoded source, and the store
    // holds the only source in play when each request is made, so answering
    // for the current store code is answering for the requested one.
    window.fetch = vi.fn(() => {
      const current = store.state.diagram.plantUmlCode as string;
      return Promise.resolve(new Response(serverSvgFor(current), { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('paints the server SVG on first mount without waiting for the edit debounce', async () => {
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: CODE_A };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await settleMicrotasks();

    // No timer has been advanced: a 500 ms debounce would still be pending.
    expect(wrapper.find('.plantuml-render svg').exists()).toBe(true);
    expect(wrapper.find('.plantuml-render svg').text()).toContain('first paint');
  });

  it('still debounces a source edit after mount', async () => {
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.PlantUml, plantUmlCode: CODE_A };

    const wrapper = mount(PlantUml, { global: { plugins: [store] } });
    await settleMicrotasks();
    expect(wrapper.find('.plantuml-render svg').text()).toContain('first paint');

    store.state.diagram = { ...store.state.diagram, plantUmlCode: CODE_B };
    await settleMicrotasks();
    // Validation ran, but the render of the edit is held by the debounce.
    expect(wrapper.find('.plantuml-render svg').text()).toContain('first paint');

    await vi.advanceTimersByTimeAsync(500);
    await settleMicrotasks();
    expect(wrapper.find('.plantuml-render svg').text()).toContain('edited');
  });
});
