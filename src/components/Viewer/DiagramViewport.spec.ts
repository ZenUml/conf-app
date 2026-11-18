import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DiagramViewport from '@/components/Viewer/DiagramViewport.vue';
import svgPanZoom from 'svg-pan-zoom';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(() => Promise.resolve()),
}));

const panZoom = vi.hoisted(() => ({
  destroy: vi.fn(),
  disableDblClickZoom: vi.fn(),
  getSizes: vi.fn(() => ({ realZoom: 1 })),
  getZoom: vi.fn(() => 1),
  reset: vi.fn(),
  resize: vi.fn(),
  zoom: vi.fn(),
  zoomIn: vi.fn(),
  zoomBy: vi.fn(),
  zoomOut: vi.fn(),
  zoomAtPointBy: vi.fn(),
  panBy: vi.fn(),
  getPan: vi.fn(() => ({ x: 0, y: 0 })),
  setMinZoom: vi.fn(),
  setMaxZoom: vi.fn(),
  setBeforePan: vi.fn(),
  center: vi.fn(),
}));
vi.mock('svg-pan-zoom', () => ({ default: vi.fn(() => panZoom) }));
vi.mock('hammerjs', () => ({
  default: vi.fn(() => ({ destroy: vi.fn(), get: vi.fn(() => ({ set: vi.fn() })), on: vi.fn() })),
}));

const SVG = '<svg viewBox="0 0 322 243"><g><text x="10" y="20">Alice</text></g></svg>';

/** `isDisplayMode` false is the editor preview; true is the page viewer. */
function mountViewport(isDisplayMode: boolean) {
  return mount(DiagramViewport, {
    props: { html: SVG, macroType: 'plantuml', label: 'PlantUML', contentClass: 'plantuml-render' },
    global: { mocks: { $store: { getters: { isDisplayMode } } } },
  });
}

/**
 * VTU's `trigger` cannot set `ctrlKey` — it is getter-only on MouseEvent — so
 * the modifier cases dispatch a real WheelEvent. Returns it, so a test can also
 * assert whether the page's scroll was taken away.
 */
function wheel(element: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  element.dispatchEvent(event);
  return event;
}

describe('DiagramViewport initial zoom', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    panZoom.getSizes.mockReturnValue({ realZoom: 1 });
    panZoom.getZoom.mockReturnValue(1);
    // jsdom lays nothing out and attach() refuses a 0 x 0 SVG.
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243, left: 0, top: 0,
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
  });

  it('fits SVG height and width independently using natural bounds after a zoom', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();
    panZoom.getSizes.mockReturnValue({ realZoom: 2, width: 800, height: 300, viewBox: { width: 1000, height: 200 } } as any);
    panZoom.getZoom.mockReturnValue(4);
    wrapper.vm.fitAxis('height');
    expect(panZoom.zoom).toHaveBeenLastCalledWith(3);
    expect(panZoom.center).toHaveBeenCalledTimes(1);
    wrapper.vm.fitAxis('width');
    expect(panZoom.zoom).toHaveBeenLastCalledWith(1.6);
    expect(panZoom.center).toHaveBeenCalledTimes(2);
  });

  it('shrinks a diagram the editor pane enlarged back to 1:1', async () => {
    // `fit: true` fills the pane in both axes, so a small diagram in a tall
    // editor pane comes out magnified — 1.4x here, ~3x in a real 850px pane.
    panZoom.getSizes.mockReturnValue({ realZoom: 1.4 });
    panZoom.getZoom.mockReturnValue(1.4);

    const wrapper = mountViewport(false);
    await wrapper.vm.attach();

    // 1.4 / 1.4 = 1: exactly natural size, never magnified.
    expect(panZoom.zoom).toHaveBeenLastCalledWith(1);
  });

  it('leaves a diagram the pane had to shrink alone', async () => {
    panZoom.getSizes.mockReturnValue({ realZoom: 0.4 });
    panZoom.getZoom.mockReturnValue(0.875);

    const wrapper = mountViewport(false);
    await wrapper.vm.attach();

    // Only the editor's breathing-room zoom; the fit itself is untouched.
    expect(panZoom.zoom).toHaveBeenCalledTimes(1);
    expect(panZoom.zoom).toHaveBeenCalledWith(0.875);
  });

  it('clamps the page viewer too, so the preview predicts the page', async () => {
    // PlantUML used to stretch to the column at any size: this 247x188 sequence
    // drew at 2.36x in a 760px column while the editor showed it at 1:1.
    panZoom.getSizes.mockReturnValue({ realZoom: 2.36 });
    panZoom.getZoom.mockReturnValue(2.36);

    const wrapper = mountViewport(true);
    await wrapper.vm.attach();

    // No 0.875 here -- the inline box is sized to the diagram's own ratio -- but
    // the same 1:1 ceiling as every other surface.
    expect(panZoom.zoom).toHaveBeenCalledTimes(1);
    expect(panZoom.zoom).toHaveBeenCalledWith(1);
  });

  it('sizes the inline box to the diagram, not the column, when no px max-width is declared', async () => {
    // Mermaid states its natural width as an inline `max-width: <n>px`; PlantUML's
    // is a stylesheet `max-width: 100%`, so the viewBox is the only natural width
    // available -- and without it the box takes the whole column, which is what
    // magnified a 322x243 diagram to 2.36x on a published page.
    // jsdom parses neither viewBox.baseVal nor layout, so both are supplied here.
    Object.defineProperty(SVGSVGElement.prototype, 'viewBox', {
      configurable: true,
      get: () => ({ baseVal: { width: 322, height: 243 } }),
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 760,
    });

    try {
      const wrapper = mountViewport(true);
      await wrapper.vm.attach();

      // The diagram's own 243px, not the 574px a 760px column would imply.
      expect(wrapper.get('.diagram-viewport').attributes('style')).toContain('height: 243px');
    } finally {
      delete (SVGSVGElement.prototype as unknown as Record<string, unknown>).viewBox;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });
});

describe('DiagramViewport wheel zoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panZoom.getSizes.mockReturnValue({ realZoom: 1 });
    panZoom.getZoom.mockReturnValue(1);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243, left: 0, top: 0,
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
  });

  it("turns off svg-pan-zoom's own wheel zoom, which cannot require a modifier", async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();

    const [, options] = vi.mocked(svgPanZoom).mock.calls[0];
    expect(options).toMatchObject({ mouseWheelZoomEnabled: false });
  });

  it('reports one event for a wheel gesture, not one per wheel event', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();
    const viewport = wrapper.get('.diagram-viewport').element;

    // A trackpad emits a stream; this is six wheel events in one continuous push.
    for (let i = 0; i < 6; i += 1) wheel(viewport, { deltaY: -100, ctrlKey: true });

    expect(panZoom.zoomAtPointBy).toHaveBeenCalledTimes(6);
    const zooms = vi.mocked(trackAnalyticsEvent).mock.calls
      .filter(([name]) => name === 'viewport_control_used');
    // One act of intent, costing the same one event as a button click.
    expect(zooms).toHaveLength(1);
    expect(zooms[0][1]).toMatchObject({
      macro_type: 'plantuml',
      viewport_action: 'zoom_in',
      viewport_input: 'wheel',
      wheel_modifier: 'ctrl_meta',
      surface: 'viewer',
    });
  });

  it('zooms on Ctrl/Cmd + wheel, at the pointer', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();
    const viewport = wrapper.get('.diagram-viewport').element;

    wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 120, clientY: 40 });
    const [factor, point] = panZoom.zoomAtPointBy.mock.calls[0];
    expect(factor).toBeCloseTo(Math.exp(0.1));
    // Relative to the SVG box, which svg-pan-zoom zooms in.
    expect(point).toEqual({ x: 120, y: 40 });

    // macOS holds Cmd, and a trackpad pinch arrives as a ctrlKey wheel.
    wheel(viewport, { deltaY: 100, metaKey: true });
    expect(panZoom.zoomAtPointBy.mock.calls[1][0]).toBeCloseTo(Math.exp(-0.1));
  });

  it('leaves a plain wheel to the page rather than zooming', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();

    // Mermaid and PlantUML took the wheel unconditionally before this: on a page
    // of diagrams the reader's scroll stopped wherever the pointer landed.
    const event = wheel(wrapper.get('.diagram-viewport').element, { deltaY: -400 });

    expect(panZoom.zoomAtPointBy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('zooms on a plain wheel in the editor preview, which has no page to scroll', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.attach();

    const event = wheel(wrapper.get('.diagram-viewport').element, { deltaY: -100 });

    expect(event.defaultPrevented).toBe(true);
    expect(panZoom.zoomAtPointBy).toHaveBeenCalledTimes(1);
    const zooms = vi.mocked(trackAnalyticsEvent).mock.calls
      .filter(([name]) => name === 'viewport_control_used');
    expect(zooms[0][1]).toMatchObject({ surface: 'editor', wheel_modifier: 'none' });
  });

  it('pans on Shift + wheel in the editor preview', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.attach();

    wheel(wrapper.get('.diagram-viewport').element, { deltaY: 60, shiftKey: true });

    expect(panZoom.zoomAtPointBy).not.toHaveBeenCalled();
    expect(panZoom.panBy).toHaveBeenCalledWith({ x: -60, y: 0 });
  });

  it('limits zoom to the opening size and natural size', async () => {
    // Opened at half natural size (realZoom 0.5), 0.875 of svg-pan-zoom's fit.
    panZoom.getSizes.mockReturnValue({ realZoom: 0.5 });
    panZoom.getZoom.mockReturnValue(0.875);
    const wrapper = mountViewport(false);
    await wrapper.vm.attach();

    // svg-pan-zoom's limits are relative to its fit: 0.875 per 0.5 natural.
    expect(panZoom.setMinZoom).toHaveBeenLastCalledWith(0.875);
    expect(panZoom.setMaxZoom).toHaveBeenLastCalledWith(1.75);
  });

  it('steps x1.25 per toolbar click, the step shared by every renderer', async () => {
    panZoom.getSizes.mockReturnValue({ realZoom: 0.5 });
    panZoom.getZoom.mockReturnValue(0.875);
    const wrapper = mountViewport(false);
    await wrapper.vm.attach();
    await wrapper.vm.$nextTick();

    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    expect(panZoom.zoomBy).toHaveBeenLastCalledWith(1.25);
    expect(panZoom.zoomIn).not.toHaveBeenCalled();
    const [, options] = vi.mocked(svgPanZoom).mock.calls.at(-1)!;
    options!.onZoom!(1.2);
    await wrapper.vm.$nextTick();
    await wrapper.get('[aria-label="Zoom out"]').trigger('click');
    expect(panZoom.zoomBy).toHaveBeenLastCalledWith(1 / 1.25);
  });

  it('disables Zoom in at natural size and Zoom out at the opening size', async () => {
    panZoom.getSizes.mockReturnValue({ realZoom: 0.5 });
    panZoom.getZoom.mockReturnValue(0.875);
    const wrapper = mountViewport(false);
    await wrapper.vm.attach();
    await wrapper.vm.$nextTick();
    const button = (name: string) => wrapper.get(`[aria-label="${name}"]`);

    expect(button('Zoom in').attributes('disabled')).toBeUndefined();
    expect(button('Zoom out').attributes('disabled')).toBeDefined();

    // svg-pan-zoom reports each zoom through onZoom, relative to its fit.
    const [, options] = vi.mocked(svgPanZoom).mock.calls.at(-1)!;
    options!.onZoom!(1.75);
    await wrapper.vm.$nextTick();
    expect(button('Zoom in').attributes('disabled')).toBeDefined();
    expect(button('Zoom out').attributes('disabled')).toBeUndefined();
  });

  it('offers no Zoom in for a diagram that opens at natural size', async () => {
    panZoom.getSizes.mockReturnValue({ realZoom: 1 });
    panZoom.getZoom.mockReturnValue(1);
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[aria-label="Zoom in"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="Zoom out"]').attributes('disabled')).toBeDefined();
  });

  it('keeps the diagram edge at the box edge when panned', async () => {
    panZoom.getSizes.mockReturnValue({
      realZoom: 2, width: 400, height: 300, viewBox: { x: 0, y: 0, width: 322, height: 243 },
    });
    const wrapper = mountViewport(false);
    await wrapper.vm.attach();

    const beforePan = panZoom.setBeforePan.mock.calls.at(-1)?.[0];
    // 644 x 486 in a 400 x 300 box: the left edge stops at 0, the right at 400.
    expect(beforePan({ x: 0, y: 0 }, { x: 90, y: -900 })).toEqual({ x: 0, y: -186 });
    expect(beforePan({ x: 0, y: 0 }, { x: -100, y: -50 })).toEqual({ x: -100, y: -50 });
  });

  it('cancels a Safari pinch and zooms the diagram instead', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();
    const viewport = wrapper.get('.diagram-viewport').element;

    viewport.dispatchEvent(new Event('gesturestart', { cancelable: true }));
    const change = Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 1.2, clientX: 5, clientY: 6 });
    viewport.dispatchEvent(change);

    expect(change.defaultPrevented).toBe(true);
    expect(panZoom.zoomAtPointBy.mock.calls[0][0]).toBeCloseTo(1.2);
  });

  it('names the wheel shortcut on the zoom buttons', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();

    // The tooltip is how someone who reached for the buttons learns the gesture.
    expect(wrapper.get('[aria-label="Zoom in"]').attributes('title')).toBe('Zoom in (\u2318/Ctrl + scroll)');
    // ...but the accessible name stays the bare action.
    expect(wrapper.get('[aria-label="Zoom in"]').attributes('aria-label')).toBe('Zoom in');
  });
});

describe('DiagramViewport Fullscreen zoom summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    panZoom.getSizes.mockReturnValue({ realZoom: 0.5 });
    panZoom.getZoom.mockReturnValue(1);
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243,
    } as DOMRect);
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // a sampled view
    (window as { forgeGlobal?: unknown }).forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
  });

  it('reports toolbar clicks and the scale the reader ended at, relative to the opening scale', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.attach();
    panZoom.zoomBy.mockImplementation((k: number) => panZoom.getSizes.mockReturnValue({ realZoom: 0.5 * k }));

    await wrapper.get('button[aria-label="Zoom in"]').trigger('click');
    vi.advanceTimersByTime(10_000);

    const rows = vi.mocked(trackAnalyticsEvent).mock.calls
      .filter(([name]) => name === 'fullscreen_zoom_summary');
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toMatchObject({ surface: 'fullscreen', macro_type: 'plantuml', zoom_in_clicks: 1, sample_rate: 0.1 });
    expect(rows[0][1].zoom_ratio_end).toBeCloseTo(1.25, 5);
    wrapper.unmount();
  });
});
