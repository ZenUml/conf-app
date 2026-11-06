import { beforeEach, describe, expect, it, vi } from 'vitest';
import { magicGenerationKey, magicPreferenceKey, magicFeedbackKey, readMagicPreference, readMagicFeedback, writeMagicPreference, writeMagicFeedback } from './localPreference';
import type { MagicArtifact } from '@/model/Diagram/Diagram';

const identity = { accountId: 'user-A', cloudId: 'site-A', contentId: 'content-A', sourceHash: 'a'.repeat(64) };
const artifact: MagicArtifact = { sourceHash: identity.sourceHash, rulesVersion: 'magic-v1', outcome: 'validated', svg: '<svg/>' };

describe('browser-local Magic choice and layout feedback', () => {
  beforeEach(() => localStorage.clear());

  it('keys choice separately by account, installation, content, and exact source', () => {
    expect(magicPreferenceKey({ ...identity, accountId: null })).toBeNull();
    expect(magicPreferenceKey({ ...identity, sourceHash: 'bad' })).toBeNull();
    expect(writeMagicPreference(identity, 'original')).toBe(true);
    expect(readMagicPreference(identity)).toBe('original');
    for (const change of [{ accountId: 'user-B' }, { cloudId: 'site-B' }, { contentId: 'content-B' }, { sourceHash: 'b'.repeat(64) }]) {
      expect(readMagicPreference({ ...identity, ...change })).toBeNull();
    }
  });

  it('ties layout feedback to the SVG generation, not only to the source', async () => {
    const first = await magicGenerationKey(artifact);
    const second = await magicGenerationKey({ ...artifact, svg: '<svg><path/></svg>' });
    expect(second).not.toBe(first);
    expect(magicFeedbackKey(identity, first)).not.toBe(magicFeedbackKey(identity, second));
    expect(writeMagicFeedback(identity, first, 'magic')).toBe(true);
    expect(readMagicFeedback(identity, first)).toBe('magic');
    expect(readMagicFeedback(identity, second)).toBeNull();
    expect(writeMagicFeedback(identity, first, 'no_preference')).toBe(true);
    expect(readMagicFeedback(identity, first)).toBe('no_preference');
    expect(writeMagicFeedback(identity, first, 'bad' as any)).toBe(false);
  });

  it('fails safely when browser storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readMagicPreference(identity)).toBeNull();
    expect(writeMagicPreference(identity, 'original')).toBe(false);
    expect(readMagicFeedback(identity, 'b'.repeat(64))).toBeNull();
    expect(writeMagicFeedback(identity, 'b'.repeat(64), 'original')).toBe(false);
    get.mockRestore(); set.mockRestore();
  });
});
