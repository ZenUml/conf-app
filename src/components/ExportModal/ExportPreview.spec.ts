import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExportPreview from './ExportPreview.vue';
import { exportStateKey, useExportState } from './useExportState';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

/**
 * The intent signal. `export_png_succeeded`'s `has_note` / `has_arrow` /
 * `has_callout` / `has_watermark` are an OUTCOME snapshot: a user who picks a
 * tool, finds the controls unusable and exports without the annotation is
 * indistinguishable from one who never wanted an annotation. Since launch
 * (2026-07-20) 376 exports carry exactly one `has_note=true`, and that number
 * cannot currently be read as demand. Tracking the tool click separates the
 * two: tool clicks without annotated exports means the UI blocks people.
 */
function mountPreview(props: Record<string, unknown> = {}) {
  const state = useExportState();
  const wrapper = mount(ExportPreview, {
    props: { state, surface: 'viewer', macroType: 'plantuml', ...props },
    global: { provide: { [exportStateKey as symbol]: state } },
  });
  return { wrapper, state };
}

beforeEach(() => {
  vi.mocked(trackAnalyticsEvent).mockClear();
});

describe('ExportPreview — annotation intent tracking', () => {
  it.each([
    ['Arrow (drag to draw)', 'arrow'],
    ['Callout (click to place)', 'callout'],
    ['Note (click to place)', 'note'],
  ])('tracks %s as a tool click', async (label, tool) => {
    const { wrapper } = mountPreview();
    await wrapper.find(`button[aria-label="${label}"]`).trigger('click');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'export_annotation_tool_clicked',
      expect.objectContaining({ feature_area: 'macro', tool }),
    );
    wrapper.unmount();
  });

  it('tracks the watermark toggle as a tool click', async () => {
    const { wrapper } = mountPreview();
    await wrapper.find('button[aria-label="Watermark (toggle)"]').trigger('click');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'export_annotation_tool_clicked',
      expect.objectContaining({ tool: 'watermark' }),
    );
    wrapper.unmount();
  });

  it('carries the surface, so inline intent is separable from fullscreen intent', async () => {
    // The whole reason the event exists is to tell "nobody wants annotations"
    // apart from "the inline dialog was too small to operate". Without the
    // surface both surfaces land in one bucket and the question stays open.
    const { wrapper } = mountPreview({ surface: 'fullscreen', macroType: 'mermaid' });
    await wrapper.find('button[aria-label="Note (click to place)"]').trigger('click');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'export_annotation_tool_clicked',
      expect.objectContaining({ surface: 'fullscreen', macro_type: 'mermaid', tool: 'note' }),
    );
    wrapper.unmount();
  });

  it('does not track turning a tool back off — the intent was already recorded', async () => {
    const { wrapper } = mountPreview();
    const note = wrapper.find('button[aria-label="Note (click to place)"]');
    await note.trigger('click');
    vi.mocked(trackAnalyticsEvent).mockClear();
    await note.trigger('click');
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('deselects a selected annotation instead of re-arming and double-counting its tool', async () => {
    const { wrapper, state } = mountPreview();
    state.callout.text = 'Retry happens here';
    state.callout.position = { x: 0.46, y: 0.4 };
    state.selectedAnnotation.value = 'callout';
    await wrapper.vm.$nextTick();

    expect(wrapper.find('button[aria-label="Callout (click to place)"]').attributes('aria-pressed')).toBe('true');

    await wrapper.find('button[aria-label="Callout (click to place)"]').trigger('click');

    expect(state.selectedAnnotation.value).toBe(null);
    expect(state.activeTool.value).toBe(null);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
