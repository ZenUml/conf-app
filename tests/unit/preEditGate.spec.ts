import { describe, expect, it } from 'vitest';
import {
  isPageEditorEditBlocked,
  isPageEditorCreateBlocked,
  isFullscreenViewerBlocked,
} from '@/utils/paywall/preEditGate';

describe('isPageEditorEditBlocked', () => {
  it('blocks existing macro edits when paywall block is active', () => {
    expect(isPageEditorEditBlocked('12345', true)).toBe(true);
  });

  it('does not block new macro creation even when paywall block is active', () => {
    expect(isPageEditorEditBlocked(undefined, true)).toBe(false);
  });

  it('does not block when paywall block is inactive', () => {
    expect(isPageEditorEditBlocked('12345', false)).toBe(false);
  });
});

describe('isPageEditorCreateBlocked', () => {
  it('blocks new macro creation when paywall block is active', () => {
    expect(isPageEditorCreateBlocked(true)).toBe(true);
  });

  it('does not block new macro creation when paywall block is inactive', () => {
    expect(isPageEditorCreateBlocked(false)).toBe(false);
  });
});

describe('isFullscreenViewerBlocked', () => {
  it('blocks when fullscreen + viewer + paywall is active', () => {
    expect(isFullscreenViewerBlocked(true, false, true)).toBe(true);
  });

  it('does not block when not in fullscreen', () => {
    expect(isFullscreenViewerBlocked(false, false, true)).toBe(false);
  });

  it('does not block when in editor mode (editor gates own that path)', () => {
    expect(isFullscreenViewerBlocked(true, true, true)).toBe(false);
  });

  it('does not block when paywall is inactive', () => {
    expect(isFullscreenViewerBlocked(true, false, false)).toBe(false);
  });

  it('does not block when nothing is true', () => {
    expect(isFullscreenViewerBlocked(false, false, false)).toBe(false);
  });
});
