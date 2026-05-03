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

  it('uses the Forge moduleKey-based isEmbedMode helper', () => {
    expect(source).toMatch(/isEmbedMode/);
  });
});
