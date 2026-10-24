import { describe, it, expect } from 'vitest';
import { useExportState } from './useExportState';

describe('useExportState — background', () => {
  it('selectBackground sets background.value', () => {
    const state = useExportState();
    state.selectBackground('cool');
    expect(state.background.value).toBe('cool');
  });

  it.each([
    ['transparent', 'transparent'],
    ['white', '#ffffff'],
    ['warm', '#fffbf0'],
    ['cool', '#f0f4ff'],
  ] as const)('resolvedBgColor maps %s to %s', (value, expected) => {
    const state = useExportState();
    state.selectBackground(value);
    expect(state.resolvedBgColor.value).toBe(expected);
  });

  it('resolvedBgColor reflects customBgColor when background is custom', () => {
    const state = useExportState();
    state.customBgColor.value = '#123456';
    state.selectBackground('custom');
    expect(state.resolvedBgColor.value).toBe('#123456');

    state.customBgColor.value = '#abcdef';
    expect(state.resolvedBgColor.value).toBe('#abcdef');
  });
});

describe('useExportState — removeAnnotation', () => {
  it('clears note text/notePoint and deselects', () => {
    const state = useExportState();
    state.note.text = 'hello';
    state.notePoint.value = { x: 0.5, y: 0.5 };
    state.selectedAnnotation.value = 'note';

    state.removeAnnotation('note');

    expect(state.note.text).toBe('');
    expect(state.notePoint.value).toBe(null);
    expect(state.selectedAnnotation.value).toBe(null);
  });

  it('clears arrow points/interaction (via resetArrow) and deselects', () => {
    const state = useExportState();
    state.arrowPoints.value = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    state.arrowInteraction.value = 'placed';
    state.selectedAnnotation.value = 'arrow';

    state.removeAnnotation('arrow');

    expect(state.arrowPoints.value).toBe(null);
    expect(state.arrowInteraction.value).toBe('idle');
    expect(state.selectedAnnotation.value).toBe(null);
  });

  it('clears watermarkVisible and deselects', () => {
    const state = useExportState();
    state.watermarkVisible.value = true;
    state.selectedAnnotation.value = 'watermark';

    state.removeAnnotation('watermark');

    expect(state.watermarkVisible.value).toBe(false);
    expect(state.selectedAnnotation.value).toBe(null);
  });

  it('clears callout text/position/tipPosition and deselects', () => {
    const state = useExportState();
    state.callout.text = 'note this';
    state.callout.position = { x: 0.4, y: 0.4 };
    state.callout.tipPosition = { x: 0.4, y: 0.6 };
    state.selectedAnnotation.value = 'callout';

    state.removeAnnotation('callout');

    expect(state.callout.text).toBe('');
    expect(state.callout.position).toBe(null);
    expect(state.callout.tipPosition).toBe(null);
    expect(state.selectedAnnotation.value).toBe(null);
  });
});

describe('useExportState — has* computeds', () => {
  it('hasArrow is true only once points exist AND interaction is placed', () => {
    const state = useExportState();
    expect(state.hasArrow.value).toBe(false);

    state.arrowPoints.value = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    state.arrowInteraction.value = 'creating';
    expect(state.hasArrow.value).toBe(false);

    state.arrowInteraction.value = 'placed';
    expect(state.hasArrow.value).toBe(true);
  });

  it('hasNote tracks whether note.text is non-empty', () => {
    const state = useExportState();
    expect(state.hasNote.value).toBe(false);
    state.note.text = 'hi';
    expect(state.hasNote.value).toBe(true);
  });

  it('hasCallout requires both a position and text', () => {
    const state = useExportState();
    expect(state.hasCallout.value).toBe(false);

    state.callout.position = { x: 0.5, y: 0.5 };
    expect(state.hasCallout.value).toBe(false);

    state.callout.text = 'label';
    expect(state.hasCallout.value).toBe(true);
  });

  it('hasWatermark requires both watermarkVisible and non-empty text', () => {
    const state = useExportState();
    expect(state.hasWatermark.value).toBe(false);

    state.watermarkVisible.value = true;
    expect(state.hasWatermark.value).toBe(true);

    state.watermark.text = '';
    expect(state.hasWatermark.value).toBe(false);
  });
});
