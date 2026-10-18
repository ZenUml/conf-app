import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Toolbar from './DiagramViewportToolbar.vue';
import { VIEWER_ZOOM_HEADER } from '@/utils/viewport/headerZoom';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as any).forgeGlobal;
  vi.clearAllMocks();
});

describe('viewport header toolbar', () => {
  it('moves one control group to its viewer header, then restores the two-button fallback', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const target = ref<HTMLElement | null>(host);
    const wrapper = mount(Toolbar, {
      props: { macroType: 'sequence', label: 'Sequence' },
      global: {
        provide: { [VIEWER_ZOOM_HEADER]: { target, fitControls: ref(false), changed: vi.fn() } },
        mocks: { $store: { getters: { isDisplayMode: true } } },
      },
    });
    expect([...host.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Zoom out', 'Zoom in']);
    expect(host.firstElementChild?.classList.contains('diagram-viewport-toolbar--compact')).toBe(true);
    target.value = null;
    await nextTick();
    expect(host.children).toHaveLength(0);
    expect(wrapper.findAll('button')).toHaveLength(2);
    wrapper.unmount();
  });

  it('disables header controls until rendering is ready, without emitting intent or outcome', () => {
    const target = ref(document.createElement('div'));
    const wrapper = mount(Toolbar, {
      props: { macroType: 'mermaid', label: 'Mermaid', ready: false },
      global: {
        provide: { [VIEWER_ZOOM_HEADER]: { target, fitControls: ref(false), changed: vi.fn() } },
        mocks: { $store: { getters: { isDisplayMode: true } } },
      },
    });
    const buttons = target.value.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach(button => { expect(button.disabled).toBe(true); button.click(); });
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('reports fullscreen header fits on the fullscreen surface', () => {
    (window as any).forgeGlobal = { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } };
    const target = ref(document.createElement('div'));
    const wrapper = mount(Toolbar, {
      props: { macroType: 'plantuml', label: 'PlantUML' },
      global: {
        provide: { [VIEWER_ZOOM_HEADER]: { target, fitControls: ref(true), changed: vi.fn() } },
        mocks: { $store: { getters: { isDisplayMode: true } } },
      },
    });
    target.value.querySelector<HTMLButtonElement>('[aria-label="Fit height"]')!.click();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewport_control_used', expect.objectContaining({
      surface: 'fullscreen', viewport_action: 'fit_height', viewport_input: 'toolbar',
    }));
    wrapper.unmount();
  });
});
