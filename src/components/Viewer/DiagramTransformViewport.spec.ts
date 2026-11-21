import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DiagramTransformViewport from '@/components/Viewer/DiagramTransformViewport.vue';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

/** A 1000x400 diagram, the shape ZenUML renders: `.zenuml > div`. */
const NATURAL = { width: 1000, height: 400 };

function mountViewport(sizeToContent: boolean, box = { width: 500, height: 300 }) {
  // jsdom lays nothing out, so both the box and the rendered content need sizes.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true, get: () => box.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true, get: () => box.height,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true, get: () => NATURAL.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true, get: () => NATURAL.height,
  });
  return mount(DiagramTransformViewport, {
    props: {
      macroType: 'sequence',
      label: 'Sequence',
      contentSelector: '.zenuml > div',
      sizeToContent,
    },
    slots: { default: '<div class="zenuml"><div class="rendered"></div></div>' },
    global: { mocks: { $store: { getters: { isDisplayMode: sizeToContent } } } },
  });
}

function scaleOf(wrapper: ReturnType<typeof mountViewport>) {
  const transform = wrapper.get('.rendered').attributes('style') ?? '';
  return Number(/scale\(([\d.]+)\)/.exec(transform)?.[1]);
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

describe('DiagramTransformViewport', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const prop of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
    delete (window as { forgeGlobal?: unknown }).forgeGlobal;
  });

  it('scales a diagram down to the box width', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();

    // 500 / 1000. ViewResizer did exactly this, so the page viewer is unchanged.
    expect(scaleOf(wrapper)).toBe(0.5);
  });

  it('never magnifies a diagram smaller than its box', async () => {
    const wrapper = mountViewport(true, { width: 4000, height: 3000 });
    await wrapper.vm.layout();

    // The same 1:1 ceiling the SVG viewports apply.
    expect(scaleOf(wrapper)).toBe(1);
  });

  it('takes the scaled height on the page viewer, which has none to inherit', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();

    // 400 natural * 0.5 fit. The Forge macro iframe is sized by this.
    expect(wrapper.get('.transform-viewport').attributes('style')).toContain('height: 200px');
  });

  it('fits both axes when the pane has a height of its own', async () => {
    const wrapper = mountViewport(false, { width: 500, height: 100 });
    await wrapper.vm.layout();

    // 100 / 400 beats 500 / 1000: the shorter axis wins, and no height is set.
    expect(scaleOf(wrapper)).toBe(0.25);
    expect(wrapper.get('.transform-viewport').attributes('style') ?? '').not.toContain('height:');
  });

  it('zooms from the toolbar on top of the fit', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();

    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    expect(scaleOf(wrapper)).toBeCloseTo(0.6, 5);

    await wrapper.get('[aria-label="Zoom out"]').trigger('click');
    expect(scaleOf(wrapper)).toBeCloseTo(0.5, 5);
  });

  it('fits the requested axis and recentres after a pan/zoom', async () => {
    const wrapper = mountViewport(false, { width: 500, height: 300 });
    await wrapper.vm.layout();
    wrapper.vm.zoomIn();
    wrapper.vm.fitAxis('height');
    expect(scaleOf(wrapper)).toBeCloseTo(0.75, 5);
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(-125px, 0px)');
    wrapper.vm.fitAxis('width');
    expect(scaleOf(wrapper)).toBeCloseTo(0.5, 5);
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(0px, 50px)');
  });

  it('zooms on Ctrl/Cmd + wheel', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport').element;

    // One 100px notch is capped to 50px of zoom: 0.5 fit * exp(0.1).
    wheel(viewport, { deltaY: -100, ctrlKey: true });
    expect(scaleOf(wrapper)).toBeCloseTo(0.5 * Math.exp(0.1), 5);

    // macOS holds Cmd, and a trackpad pinch arrives as a ctrlKey wheel.
    wheel(viewport, { deltaY: 100, metaKey: true });
    expect(scaleOf(wrapper)).toBeCloseTo(0.5, 5);
  });

  it('zooms at the pointer, keeping the point under it still', async () => {
    const wrapper = mountViewport(false, { width: 500, height: 300 });
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport').element;

    // Content point under the pointer at fit 0.5: (400 - 0) / 0.5 = 800.
    wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 100 });
    const scale = scaleOf(wrapper);
    const x = Number(/translate\((-?[\d.]+)px/.exec(wrapper.get('.rendered').attributes('style') ?? '')?.[1]);
    expect(x + 800 * scale).toBeCloseTo(400, 3);
  });

  it('zooms on a plain wheel in fullscreen and the editor preview', async () => {
    // sizeToContent false is fullscreen/editor: no page behind the diagram.
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();

    const event = wheel(wrapper.get('.transform-viewport').element, { deltaY: -100 });

    expect(event.defaultPrevented).toBe(true);
    expect(scaleOf(wrapper)).toBeCloseTo(0.5 * Math.exp(0.1), 5);
  });

  it('pans on Shift + wheel in fullscreen once the diagram is larger than the box', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();
    wrapper.vm.zoomIn();
    wrapper.vm.zoomIn();
    const before = wrapper.get('.rendered').attributes('style');

    wheel(wrapper.get('.transform-viewport').element, { deltaY: 40, shiftKey: true });

    expect(scaleOf(wrapper)).toBeCloseTo(0.72, 5);
    expect(wrapper.get('.rendered').attributes('style')).not.toBe(before);
  });

  it('never zooms out past the opening size or in past natural size', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();

    wrapper.vm.zoomOut();
    expect(scaleOf(wrapper)).toBeCloseTo(0.5, 5);

    for (let i = 0; i < 20; i += 1) wrapper.vm.zoomIn();
    // 1 = the size ZenUML drew it at; there is no more detail past that.
    expect(scaleOf(wrapper)).toBeCloseTo(1, 5);
  });

  it('disables Zoom in at natural size and Zoom out at the opening size', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();
    await wrapper.vm.$nextTick();
    const button = (name: string) => wrapper.get(`[aria-label="${name}"]`);

    expect(button('Zoom in').attributes('disabled')).toBeUndefined();
    expect(button('Zoom out').attributes('disabled')).toBeDefined();

    for (let i = 0; i < 20; i += 1) wrapper.vm.zoomIn();
    await wrapper.vm.$nextTick();
    expect(button('Zoom in').attributes('disabled')).toBeDefined();
    expect(button('Zoom out').attributes('disabled')).toBeUndefined();
  });

  it('offers no Zoom in for a diagram that opens at natural size', async () => {
    const wrapper = mountViewport(false, { width: 2000, height: 1000 });
    await wrapper.vm.layout();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[aria-label="Zoom in"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="Zoom out"]').attributes('disabled')).toBeDefined();
  });

  it('cancels a Safari pinch so it zooms the diagram, not the page', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport').element;

    const start = new Event('gesturestart', { cancelable: true });
    viewport.dispatchEvent(start);
    const change = Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 1.2 });
    viewport.dispatchEvent(change);

    expect(start.defaultPrevented).toBe(true);
    expect(change.defaultPrevented).toBe(true);
    expect(scaleOf(wrapper)).toBeCloseTo(0.6, 5);
  });

  it('leaves a plain wheel to the page rather than zooming', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();

    // The page viewer's Forge iframe is sized to the diagram, so a tall sequence
    // covers the reading area: taking the wheel there traps the reader.
    const event = wheel(wrapper.get('.transform-viewport').element, { deltaY: -400 });

    expect(scaleOf(wrapper)).toBeCloseTo(0.5, 5);
    expect(event.defaultPrevented).toBe(false);
    // ...and on the page viewer the wheel did what the reader wanted, so no hint.
    await wrapper.vm.$nextTick();
  });

  it('pans only once the pointer passes the click tolerance', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();
    wrapper.vm.fitAxis('height');
    const viewport = wrapper.get('.transform-viewport');

    // A ZenUML participant name is editable and the footer carries the theme
    // control, so a small press-and-release must stay a click.
    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 12, clientY: 11 });
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(-125px, 0px)');

    // 750px wide in a 500px box: x moves, y (300 = box) stays.
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 40 });
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(-75px, 0px)');
  });

  it('stops a drag at the diagram edge', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();
    wrapper.vm.fitAxis('height');
    const viewport = wrapper.get('.transform-viewport');

    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 900, clientY: 10 });
    // The left edge stops at the box's left edge.
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(0px, 0px)');
  });

  it('does not move a diagram that already fits when dragged', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport');

    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 40 });
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(0px, 0px)');
  });

  it('does not select text while dragging, and clicks still select as before', async () => {
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport');
    const removeAllRanges = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection);

    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 12, clientY: 11 });
    // Still a click: double-click word select and click-to-edit stay untouched.
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(viewport.classes()).not.toContain('transform-viewport--dragging');

    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 40 });
    expect(removeAllRanges).toHaveBeenCalled();
    expect(viewport.classes()).toContain('transform-viewport--dragging');

    await viewport.trigger('pointerup', { pointerId: 1 });
    expect(viewport.classes()).not.toContain('transform-viewport--dragging');
  });

  it('leaves the Export PNG surface untransformed and untoolbarred', async () => {
    (window as { forgeGlobal?: unknown }).forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen', openExport: true } } },
    };

    const wrapper = mountViewport(true);
    await wrapper.vm.layout();

    // A transform (and a floating toolbar) would end up in the capture.
    expect(wrapper.get('.rendered').attributes('style')).toBeUndefined();
    expect(wrapper.find('[role="toolbar"]').exists()).toBe(false);
  });
});
