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

  it('zooms on Ctrl/Cmd + wheel', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport').element;

    // 100px of wheel is one notch: 0.5 fit * 1.2.
    wheel(viewport, { deltaY: -100, ctrlKey: true });
    expect(scaleOf(wrapper)).toBeCloseTo(0.6, 5);

    // macOS holds Cmd, and a trackpad pinch arrives as a ctrlKey wheel.
    wheel(viewport, { deltaY: 100, metaKey: true });
    expect(scaleOf(wrapper)).toBeCloseTo(0.5, 5);
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
    expect(wrapper.find('.viewport-zoom-hint').exists()).toBe(false);
  });

  it('hints at the modifier where a plain wheel has nowhere to go', async () => {
    // sizeToContent false is fullscreen/editor: the pane is overflow:hidden, so
    // an ungated wheel there does nothing at all.
    const wrapper = mountViewport(false);
    await wrapper.vm.layout();

    wheel(wrapper.get('.transform-viewport').element, { deltaY: -400 });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.viewport-zoom-hint').exists()).toBe(true);
  });

  it('pans only once the pointer passes the click tolerance', async () => {
    const wrapper = mountViewport(true);
    await wrapper.vm.layout();
    const viewport = wrapper.get('.transform-viewport');

    // A ZenUML participant name is editable and the footer carries the theme
    // control, so a small press-and-release must stay a click.
    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 12, clientY: 11 });
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(0px, 0px)');

    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 40 });
    expect(wrapper.get('.rendered').attributes('style')).toContain('translate(50px, 30px)');
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
