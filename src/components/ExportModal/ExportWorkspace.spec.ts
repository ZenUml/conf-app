import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ExportWorkspace from './ExportWorkspace.vue';
import { useExportState } from './useExportState';
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

describe('export workspace', () => {
  it.each(['Add arrow', 'Add rectangle'])('draws and resizes %s independently', async (label) => {
    const state = useExportState();
    state.previewDataUrl.value = 'data:image/png;base64,AA==';
    const wrapper = mount(ExportWorkspace, { props: { state } });
    const canvas = wrapper.get('[aria-label="Annotation canvas"]');
    vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, toJSON() {} });
    await wrapper.get(`[aria-label="${label}"]`).trigger('click');
    await canvas.trigger('pointerdown', { clientX: 100, clientY: 100, button: 0 });
    await canvas.trigger('pointermove', { clientX: 400, clientY: 300 });
    await canvas.trigger('pointerup', { clientX: 400, clientY: 300 });
    expect(state.annotations.items.value).toHaveLength(1);
    expect(state.annotations.items.value[0].end).toEqual({ x: 2 / 3, y: 0.75 });
    await wrapper.get('[aria-label="Drag end handle"]').trigger('pointerdown', { clientX: 400, clientY: 300, button: 0 });
    await canvas.trigger('pointermove', { clientX: 300, clientY: 200 });
    await canvas.trigger('pointerup', { clientX: 300, clientY: 200 });
    expect(state.annotations.items.value[0].end).toEqual({ x: 0.5, y: 0.5 });
    expect(wrapper.get('[aria-label="Select annotations"]').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });
  it('places two labels, returns to select, and deletes only the selected one', async () => {
    const state = useExportState();
    state.previewDataUrl.value = 'data:image/png;base64,AA==';
    const wrapper = mount(ExportWorkspace, { props: { state } });
    const canvas = wrapper.get('[aria-label="Annotation canvas"]');
    vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, toJSON() {} });
    for (const text of ['First label', 'Second label']) {
      await wrapper.get('[aria-label="Add text"]').trigger('click');
      await canvas.trigger('pointerdown', { clientX: 200, clientY: 100, button: 0 });
      await wrapper.get('[aria-label="Annotation text"]').setValue(text);
      await wrapper.get('[aria-label="Annotation text"]').trigger('keydown', { key: 'Enter' });
    }
    expect(state.annotations.items.value.map(item => item.text)).toEqual(['First label', 'Second label']);
    expect(wrapper.get('[aria-label="Select annotations"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[aria-label="Delete annotation"]').trigger('click');
    expect(state.annotations.items.value.map(item => item.text)).toEqual(['First label']);
    wrapper.unmount();
  });
  it('shows a compact toolbar with fixed PNG and a stamp watermark button', async () => {
    const state = useExportState();
    const wrapper = mount(ExportWorkspace, { props: { state } });
    expect(wrapper.get('[role="toolbar"]').text()).toContain('PNG');
    expect(wrapper.find('[aria-label="Export format"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Add watermark"]').trigger('click');
    expect(state.watermarkVisible.value).toBe(true);
    expect(wrapper.get('[aria-label="Watermark text"]').element).toBeTruthy();
    expect(wrapper.find('.export-sidebar').exists()).toBe(false);
    wrapper.unmount();
  });
});
