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

  it('does not clamp the page viewer, which has always filled its column', async () => {
    panZoom.getSizes.mockReturnValue({ realZoom: 1.8 });
    panZoom.getZoom.mockReturnValue(1.8);

    const wrapper = mountViewport(true);
    await wrapper.vm.attach();

    // Inline gets neither the 0.875 nor the clamp: it renders at fit.
    expect(panZoom.zoom).not.toHaveBeenCalled();
    expect(panZoom.reset).toHaveBeenCalled();
  });
});
