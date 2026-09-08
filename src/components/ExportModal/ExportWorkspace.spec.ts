import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ExportWorkspace from './ExportWorkspace.vue';
import { useExportState } from './useExportState';
import { computeCalloutBox, computeTextBox } from './overlayGeometry';
import { watermarkGeometry } from './useExportEngine';
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

// jsdom has no canvas text metrics, so the real measurement collapses to a
// per-character estimate and `i` measures the same as `W` — the very bug these
// tests cover. Give each glyph a width instead, so an outline derived from the
// measurement is distinguishable from one derived from the character count.
const GLYPH_WIDTH: Record<string, number> = { i: 0.2, W: 1.6 };
vi.mock('./useExportEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useExportEngine')>();
  return {
    ...actual,
    measureTextWidth: (text: string, fontSize: number) =>
      [...text].reduce((sum, ch) => sum + (GLYPH_WIDTH[ch] ?? 0.55) * fontSize, 0),
  };
});
const measured = (text: string, fontSize: number) =>
  [...text].reduce((sum, ch) => sum + (GLYPH_WIDTH[ch] ?? 0.55) * fontSize, 0);

function mountWithPreview() {
  const state = useExportState();
  state.previewDataUrl.value = 'data:image/png;base64,AA==';
  const wrapper = mount(ExportWorkspace, { props: { state } });
  const canvas = wrapper.get('[aria-label="Annotation canvas"]');
  vi.spyOn(canvas.element, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, toJSON() {} } as DOMRect);
  return { state, wrapper, canvas };
}

async function placeText(wrapper: ReturnType<typeof mountWithPreview>['wrapper'], canvas: ReturnType<typeof mountWithPreview>['canvas'], text: string) {
  await wrapper.get('[aria-label="Add text"]').trigger('click');
  await canvas.trigger('pointerdown', { clientX: 300, clientY: 200, button: 0 });
  await wrapper.get('[aria-label="Annotation text"]').setValue(text);
  await wrapper.get('[aria-label="Annotation text"]').trigger('keydown', { key: 'Enter' });
}

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
    expect(wrapper.get('[aria-label="Select and move"]').attributes('aria-pressed')).toBe('true');
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
    expect(wrapper.get('[aria-label="Select and move"]').attributes('aria-pressed')).toBe('true');
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

  it('keeps the selection when the drawing tool is put down', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'Keep me selected');
    await wrapper.get('[aria-label="Add arrow"]').trigger('click');
    expect(state.annotations.selectedId.value).toBeNull();
    await wrapper.get('[aria-label="Select and move"]').trigger('click');
    expect(wrapper.get('[aria-label="Select and move"]').attributes('aria-pressed')).toBe('true');

    // Selecting an annotation and then returning to Select must not drop it —
    // Select is a mode, not a clear button.
    await wrapper.get('[data-annotation-id]').trigger('pointerdown', { clientX: 300, clientY: 200, button: 0 });
    await canvas.trigger('pointerup', { clientX: 300, clientY: 200 });
    expect(state.annotations.selectedId.value).not.toBeNull();
    await wrapper.get('[aria-label="Select and move"]').trigger('click');
    expect(state.annotations.selectedId.value).not.toBeNull();
    expect(wrapper.find('[aria-label="Annotation properties"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('sizes the text outline from the measured glyphs, not the character count', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'iiiiiiiiii');
    const narrow = Number(wrapper.get('[data-annotation-id] rect').attributes('width'));
    const fontSize = state.annotations.items.value[0].fontSize;
    expect(narrow).toBeCloseTo(computeTextBox(1, { textWidth: measured('iiiiiiiiii', fontSize), fontSize }).width, 5);

    state.annotations.update(state.annotations.items.value[0].id, { text: 'WWWWWWWWWW' });
    await wrapper.vm.$nextTick();
    const wide = Number(wrapper.get('[data-annotation-id] rect').attributes('width'));
    expect(wide).toBeGreaterThan(narrow * 4);
    wrapper.unmount();
  });

  it('changes annotation text color through the usable palette and serialized overlay', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'Color me');

    const color = wrapper.get('[aria-label="Annotation color"]');
    await color.trigger('click');
    expect(wrapper.get('[aria-label="Annotation color choices"]')).toBeTruthy();
    await wrapper.get('[aria-label="Blue"]').trigger('click');

    expect(state.annotations.items.value[0].color).toBe('#2563eb');
    expect(wrapper.get('.rendered-annotations').html()).toContain('fill="#2563eb"');
    expect(wrapper.get('[aria-label="Annotation color"]').attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  it('accepts a validated custom hex color without relying on the native picker', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'Custom color');
    await wrapper.get('[aria-label="Annotation color"]').trigger('click');
    const input = wrapper.get('[aria-label="Custom annotation color"]');
    await input.setValue('#12abef');
    await wrapper.get('.color-apply').trigger('click');

    expect(state.annotations.items.value[0].color).toBe('#12abef');
    expect(wrapper.get('.rendered-annotations').html()).toContain('fill="#12abef"');
    wrapper.unmount();
  });

  it('explains and disables Apply for an invalid custom color', async () => {
    const { wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'Invalid color');
    await wrapper.get('[aria-label="Annotation color"]').trigger('click');
    const input = wrapper.get('[aria-label="Custom annotation color"]');
    await input.setValue('oops');

    expect(input.attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('#color-format-error').text()).toBe('Use #RRGGBB');
    expect(wrapper.get('.color-apply').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('resets an open color menu when selecting another annotation', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'First');
    const second = state.annotations.add('note', { x: 0.7, y: 0.5 });
    state.annotations.update(second.id, { text: 'Second' });
    await wrapper.vm.$nextTick();
    await wrapper.get('[aria-label="Annotation color"]').trigger('click');
    expect(wrapper.find('[aria-label="Annotation color choices"]').exists()).toBe(true);

    await wrapper.findAll('[data-annotation-id]')[1].trigger('pointerdown', { clientX: 420, clientY: 200, button: 0 });
    await canvas.trigger('pointerup', { clientX: 420, clientY: 200 });
    expect(wrapper.find('[aria-label="Annotation color choices"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Annotation color"]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[aria-label="Annotation color"]').attributes('data-tooltip')).toBe('Annotation color');
    wrapper.unmount();
  });

  it('uses the app-owned custom background palette and validated hex input', async () => {
    const { state, wrapper } = mountWithPreview();
    state.background.value = 'custom';
    await wrapper.vm.$nextTick();
    await wrapper.get('[aria-label="Custom background color"]').trigger('click');
    await wrapper.get('[aria-label="Warm"]').trigger('click');
    expect(state.customBgColor.value).toBe('#fffbf0');

    await wrapper.get('[aria-label="Custom background color"]').trigger('click');
    const input = wrapper.get('[aria-label="Custom background hex"]');
    await input.setValue('#123456');
    await input.trigger('keydown', { key: 'Enter' });
    expect(state.customBgColor.value).toBe('#123456');
    expect(wrapper.find('[aria-label="Custom background color choices"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('tracks the live draft width while re-editing, not the last committed text', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await placeText(wrapper, canvas, 'iiiiiiiiii');
    const narrow = Number(wrapper.get('[data-annotation-id] rect').attributes('width'));

    // Re-enter editing the same way a double-click does, then edit the draft
    // without committing it — the outline must not stay pinned to the
    // pre-edit 'iiiiiiiiii' bounds while 'WWWWWWWWWW' is being typed.
    await wrapper.get('[data-annotation-id]').trigger('dblclick');
    await wrapper.get('[aria-label="Annotation text"]').setValue('WWWWWWWWWW');

    const item = state.annotations.items.value[0];
    expect(item.text).toBe('iiiiiiiiii'); // still uncommitted
    const box = computeTextBox(1, { textWidth: measured('WWWWWWWWWW', item.fontSize), fontSize: item.fontSize });
    const wide = Number(wrapper.get('[data-annotation-id] rect').attributes('width'));
    expect(wide).toBeCloseTo(box.width, 5);
    expect(wide).toBeGreaterThan(narrow * 4);
    wrapper.unmount();
  });

  it('matches the callout outline to the bubble the overlay draws', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await wrapper.get('[aria-label="Add callout"]').trigger('click');
    await canvas.trigger('pointerdown', { clientX: 300, clientY: 200, button: 0 });
    await wrapper.get('[aria-label="Annotation text"]').setValue('Retry happens here');
    await wrapper.get('[aria-label="Annotation text"]').trigger('keydown', { key: 'Enter' });

    const item = state.annotations.items.value[0];
    const box = computeCalloutBox(1, { textWidth: measured(item.text, item.fontSize), fontSize: item.fontSize });
    const outline = wrapper.get('[data-annotation-id] rect');
    expect(Number(outline.attributes('width'))).toBeCloseTo(box.width, 5);
    expect(Number(outline.attributes('height'))).toBeCloseTo(box.height, 5);
    wrapper.unmount();
  });

  it('gives the watermark a rotated hit target and sole selection', async () => {
    const { wrapper } = mountWithPreview();
    await wrapper.get('[aria-label="Add watermark"]').trigger('click');

    expect(wrapper.get('[aria-label="Add watermark"]').attributes('aria-pressed')).toBe('true');
    // Two "active" buttons at once left the user unable to tell tool from selection.
    expect(wrapper.get('[aria-label="Select and move"]').attributes('aria-pressed')).toBe('false');

    const hit = wrapper.get('[aria-label="Select watermark"]');
    expect(hit.element.parentElement?.getAttribute('transform')).toMatch(/^rotate\(-45,/);
    expect(wrapper.find('.selection-outline').exists()).toBe(true);
    wrapper.unmount();
  });

  it('sizes a shallow long-watermark hit box to the fitted SVG glyph width', async () => {
    const { state, wrapper } = mountWithPreview();
    state.previewNaturalWidth.value = 600;
    state.previewNaturalHeight.value = 70;
    state.watermark.text = 'Internal review - Confidential';
    state.watermarkVisible.value = true;
    await wrapper.get('[aria-label="Add watermark"]').trigger('click');
    const geometry = watermarkGeometry(state.watermark.text, state.watermark.fontSize, true, 600, 600 * 70 / 600, 16);
    expect(Number(wrapper.get('.selection-outline').attributes('width'))).toBeCloseTo(geometry.renderedWidth + 12, 5);
    expect(Number(wrapper.get('.selection-outline').attributes('height'))).toBeCloseTo(geometry.fontSize * 1.4, 5);
    wrapper.unmount();
  });

  it('keeps a failed export readable and offers the refresh it names', async () => {
    const { state, wrapper } = mountWithPreview();
    state.exportError.value = "Export failed — couldn't capture the diagram. Try Refresh, then export again.";
    await wrapper.vm.$nextTick();

    const alert = wrapper.get('[role="alert"]');
    expect(alert.classes()).toContain('stage-message');
    // The message used to be a flex child of the stage, which squeezed it into
    // a clipped column and shifted the preview.
    expect(alert.element.parentElement).toBe(wrapper.get('.workspace-stage').element);
    expect(wrapper.find('[aria-label="Refresh preview"]').exists()).toBe(true);
    await wrapper.get('[aria-label="Refresh preview"]').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    wrapper.unmount();
  });

  it('announces an export in progress instead of only dimming the buttons', async () => {
    const { state, wrapper } = mountWithPreview();
    expect(wrapper.find('.busy-status').exists()).toBe(false);

    state.isExporting.value = true;
    await wrapper.vm.$nextTick();
    const status = wrapper.get('[role="status"]');
    expect(status.text()).toContain('Exporting');
    expect(status.find('.spinner').exists()).toBe(true);
    expect(wrapper.get('.export-workspace').attributes('aria-busy')).toBe('true');
    wrapper.unmount();
  });

  it('discards a fresh label on Escape even when the input then blurs', async () => {
    const { state, wrapper, canvas } = mountWithPreview();
    await wrapper.get('[aria-label="Add text"]').trigger('click');
    await canvas.trigger('pointerdown', { clientX: 300, clientY: 200, button: 0 });
    const input = wrapper.get('[aria-label="Annotation text"]');
    await input.setValue('Typed but abandoned');

    await input.trigger('keydown', { key: 'Escape' });
    // Browser key injection blurs the field right after Escape; the draft must
    // not come back through the blur handler.
    await input.trigger('blur');

    expect(state.annotations.items.value).toHaveLength(0);
    wrapper.unmount();
  });
});
