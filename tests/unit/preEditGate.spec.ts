import { describe, expect, it } from 'vitest';
import { isPageEditorEditBlocked, isPageEditorCreateBlocked } from '@/utils/paywall/preEditGate';

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
