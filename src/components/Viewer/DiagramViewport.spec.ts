import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DiagramViewport from '@/components/Viewer/DiagramViewport.vue';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
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
  zoomOut: vi.fn(),
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

describe('DiagramViewport initial zoom', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    panZoom.getSizes.mockReturnValue({ realZoom: 1 });
    panZoom.getZoom.mockReturnValue(1);
    // jsdom lays nothing out and attach() refuses a 0 x 0 SVG.
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 322, height: 243,
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
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
