import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@forge/bridge', () => ({
  view: {
    getContext: vi.fn(async () => ({ cloudId: 'cloud-A' })),
  },
}));

import {
  saveDraft,
  loadDraft,
  clearDraft,
  saveDraftSync,
  primeCloudId,
  getCachedCloudId,
  makeDebouncedDraftSaver,
} from './draftStore';

beforeEach(() => {
  localStorage.clear();
  // Reset the module-level cloudId cache by re-importing — we can't reset
  // the closure, but priming again simulates a fresh editor mount.
});

describe('draftStore', () => {
  it('saveDraft + loadDraft round-trips with cloudId namespacing', async () => {
    await saveDraft('new:sequence', { code: 'A->B: hi', title: 'My Diagram' });
    const got = await loadDraft('new:sequence');
    expect(got?.code).toBe('A->B: hi');
    expect(got?.title).toBe('My Diagram');
    expect(typeof got?.savedAt).toBe('number');

    // Storage key should include cloudId.
    const keys = Object.keys(localStorage);
    expect(keys.some(k => k === 'zenuml.draft.cloud-A.new:sequence')).toBe(true);
  });

  it('loadDraft returns null when no draft exists', async () => {
    const got = await loadDraft('new:sequence');
    expect(got).toBeNull();
  });

  it('clearDraft removes the entry', async () => {
    await saveDraft('edit:42', { code: 'x', title: 't' });
    expect(await loadDraft('edit:42')).not.toBeNull();
    await clearDraft('edit:42');
    expect(await loadDraft('edit:42')).toBeNull();
  });

  it('saveDraftSync writes synchronously after primeCloudId', async () => {
    const cloudId = await primeCloudId();
    expect(getCachedCloudId()).toBe(cloudId);
    saveDraftSync('new:graph', cloudId, { code: '<mxgraph/>', title: '' });
    const got = await loadDraft('new:graph');
    expect(got?.code).toBe('<mxgraph/>');
  });

  describe('makeDebouncedDraftSaver', () => {
    afterEach(() => vi.useRealTimers());

    it('debounces multiple saves into the latest one', async () => {
      vi.useFakeTimers();
      const { save } = makeDebouncedDraftSaver('edit:7', 200);
      save({ code: 'one', title: '' });
      save({ code: 'two', title: '' });
      save({ code: 'three', title: '' });

      // Nothing written yet.
      expect(localStorage.getItem('zenuml.draft.cloud-A.edit:7')).toBeNull();

      vi.advanceTimersByTime(200);
      // Allow microtasks to settle (saveDraft awaits getCloudId).
      await vi.runAllTimersAsync();

      const got = await loadDraft('edit:7');
      expect(got?.code).toBe('three');
    });

    it('flush() writes immediately without waiting for the timer', async () => {
      const { save, flush } = makeDebouncedDraftSaver('edit:8', 5_000);
      save({ code: 'pending', title: '' });
      flush();
      // saveDraft is async (awaits getCloudId) so we wait a tick.
      await Promise.resolve();
      await Promise.resolve();
      const got = await loadDraft('edit:8');
      expect(got?.code).toBe('pending');
    });

    it('cancel() drops the pending write', async () => {
      vi.useFakeTimers();
      const { save, cancel } = makeDebouncedDraftSaver('edit:9', 200);
      save({ code: 'will-be-dropped', title: '' });
      cancel();
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      expect(await loadDraft('edit:9')).toBeNull();
    });
  });
});
