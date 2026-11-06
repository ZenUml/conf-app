import { describe, it, expect } from 'vitest';
import { BYLINE_MODAL_ORIGIN, isBylineModal } from './modalOrigin';

describe('isBylineModal', () => {
  it('recognises a modal opened by the byline', () => {
    expect(isBylineModal({ extension: { modal: { origin: BYLINE_MODAL_ORIGIN } } })).toBe(true);
  });

  it('is false for an insert-menu / native-config editor, which has no modal at all', () => {
    expect(isBylineModal({ extension: { macro: { isInserting: true } } })).toBe(false);
  });

  it('is false for the in-viewer Edit modal, which sets macroMode but no origin', () => {
    expect(isBylineModal({ extension: { modal: { macroMode: 'editor' } } })).toBe(false);
  });

  it('never throws on the shapes a Forge context can actually be', () => {
    for (const ctx of [undefined, null, {}, { extension: {} }, { extension: { modal: null } }]) {
      expect(isBylineModal(ctx)).toBe(false);
    }
  });
});
