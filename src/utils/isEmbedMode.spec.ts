import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { isEmbedMode } from '@/utils/isEmbedMode';

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    forgeContext: undefined,
  },
}));

describe('isEmbedMode', () => {
  beforeEach(() => {
    vi.mocked(forgeGlobal).forgeContext = undefined as any;
  });

  it('returns true when Forge moduleKey is the full/diagramly embed key', () => {
    vi.mocked(forgeGlobal).forgeContext = { moduleKey: 'zenuml-embed-macro' } as any;
    expect(isEmbedMode()).toBe(true);
  });

  it('returns true when Forge moduleKey is the lite embed key', () => {
    vi.mocked(forgeGlobal).forgeContext = { moduleKey: 'zenuml-embed-macro-lite' } as any;
    expect(isEmbedMode()).toBe(true);
  });

  it('returns false for non-embed modules (e.g. sequence macro)', () => {
    vi.mocked(forgeGlobal).forgeContext = { moduleKey: 'zenuml-sequence-macro' } as any;
    expect(isEmbedMode()).toBe(false);
  });

  it('returns false when forgeContext is missing', () => {
    vi.mocked(forgeGlobal).forgeContext = undefined as any;
    expect(isEmbedMode()).toBe(false);
  });

  it('returns false when moduleKey is missing', () => {
    vi.mocked(forgeGlobal).forgeContext = {} as any;
    expect(isEmbedMode()).toBe(false);
  });
});

describe('GenericViewer embed detection', () => {
  const source = readFileSync(
    resolve(__dirname, '../components/Viewer/GenericViewer.vue'),
    'utf-8',
  );

  it('does not rely on the Connect xdm_c URL parameter', () => {
    expect(source).not.toMatch(/xdm_c/);
  });

  it('uses a Forge moduleKey-based embed detection (inline or via isEmbedMode helper)', () => {
    // The V8 viewer uses inline regex on forgeContext.moduleKey instead of importing
    // the isEmbedMode helper — both are equivalent; accept either pattern.
    const usesHelper = /isEmbedMode/.test(source);
    const usesInline = /moduleKey/.test(source) && /embed-macro/.test(source);
    expect(usesHelper || usesInline).toBe(true);
  });
});
