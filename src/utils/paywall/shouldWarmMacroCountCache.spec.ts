import { describe, it, expect } from 'vitest';
import { shouldWarmMacroCountCache } from './shouldWarmMacroCountCache';

describe('shouldWarmMacroCountCache', () => {
  // Edit-capable surfaces — the paywall reads the count here, so warm.
  it('warms for the dialog editor (modal.macroMode === "editor")', () => {
    expect(shouldWarmMacroCountCache({ extension: { modal: { macroMode: 'editor' } } })).toBe(true);
  });

  it('warms for the native page-editor config surface (macro.isConfiguring)', () => {
    expect(shouldWarmMacroCountCache({ extension: { macro: { isConfiguring: true } } })).toBe(true);
  });

  it('warms while inserting a new macro (macro.isInserting)', () => {
    expect(shouldWarmMacroCountCache({ extension: { macro: { isInserting: true } } })).toBe(true);
  });

  // Viewer surfaces — nothing reads the count, so skip the space-scan.
  it('skips a plain viewer render (no modal, no macro flags)', () => {
    expect(shouldWarmMacroCountCache({ extension: { macro: { isConfiguring: false, isInserting: false } } })).toBe(false);
  });

  it('skips a fullscreen viewer (modal.macroMode === "fullscreen")', () => {
    expect(shouldWarmMacroCountCache({ extension: { modal: { macroMode: 'fullscreen' } } })).toBe(false);
  });

  it('skips when macroMode is "viewer"', () => {
    expect(shouldWarmMacroCountCache({ extension: { modal: { macroMode: 'viewer' } } })).toBe(false);
  });

  // Defensive: missing / partial context must never warm (fail closed to "skip").
  it('returns false for undefined context', () => {
    expect(shouldWarmMacroCountCache(undefined)).toBe(false);
  });

  it('returns false for null context', () => {
    expect(shouldWarmMacroCountCache(null)).toBe(false);
  });

  it('returns false for an empty extension', () => {
    expect(shouldWarmMacroCountCache({ extension: {} })).toBe(false);
  });

  it('returns false when extension is null', () => {
    expect(shouldWarmMacroCountCache({ extension: null })).toBe(false);
  });
});
