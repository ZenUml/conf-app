import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renameDiagramTitle } from '@/utils/renameDiagramTitle';
import { guardEditClick } from '@/utils/guardEditClick';
import globals from '@/model/globals';
import { syncCustomContent } from '@/services/CustomContent';
import { getCachedContent, putCachedContent, _resetForTesting } from '@/utils/renderCache/contentCacheStore';
import { DiagramType, DataSource } from '@/model/Diagram/Diagram';

vi.mock('@/utils/guardEditClick', () => ({ guardEditClick: vi.fn() }));
vi.mock('@/services/CustomContent', () => ({ syncCustomContent: vi.fn(() => Promise.resolve()) }));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getCustomContentByIdV2: vi.fn(),
      updateCustomContentV2: vi.fn(),
    },
  },
}));
vi.mock('@/model/globals/forgeGlobal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/model/globals/forgeGlobal')>();
  return { ...actual, default: { ...actual.default, forgeContext: { localId: 'local-uuid-1' } } };
});

const guard = vi.mocked(guardEditClick);
const getById = globals.apWrapper.getCustomContentByIdV2 as unknown as ReturnType<typeof vi.fn>;
const update = globals.apWrapper.updateCustomContentV2 as unknown as ReturnType<typeof vi.fn>;
const sync = vi.mocked(syncCustomContent);

// The body Confluence holds RIGHT NOW — deliberately different from anything
// the viewer has in memory, so the tests can prove the rename never writes a
// stale in-memory body over a newer one.
const freshValue = {
  id: '987654321',
  diagramType: DiagramType.Sequence,
  code: 'A->B: newest code from another editor',
  title: 'Login flow',
  source: DataSource.CustomContent,
  isCopy: false,
};
const existing = {
  id: '987654321',
  type: 'ac:zenuml-for-confluence:zenuml-content-sequence',
  status: 'current',
  pageId: '111',
  title: 'Login flow',
  version: { number: 4 },
  body: { raw: { value: JSON.stringify(freshValue) } },
  value: freshValue,
};

const rename = (title = 'Checkout flow') =>
  renameDiagramTitle({
    customContentId: '987654321',
    title,
    macroType: 'sequence',
    attribution: { customContentId: '987654321', authorAccountIds: ['acc-1'] } as any,
  });

describe('renameDiagramTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    guard.mockResolvedValue(true);
    getById.mockResolvedValue(existing);
    update.mockResolvedValue({ ...existing, version: { number: 5 } });
  });

  it('refuses without fetching or writing when the same-page duplicate guard blocks', async () => {
    guard.mockResolvedValue(false);
    const result = await rename();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'gate_blocked' });
    expect(guard).toHaveBeenCalledWith({ customContentId: '987654321', macroType: 'sequence' });
    expect(getById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('fetches the content fresh (zero-network copy check) and PUTs the fetched body with only the title changed', async () => {
    const result = await rename('Checkout flow');
    expect(result.ok).toBe(true);
    expect(getById).toHaveBeenCalledWith('987654321', { copyCheckMode: 'cross-page-only' });
    expect(update).toHaveBeenCalledTimes(1);
    const [target, body] = update.mock.calls[0];
    expect(target).toBe(existing);
    expect(body).toEqual({ ...freshValue, title: 'Checkout flow' });
    // The newest code survives — the rename never carried a stale body.
    expect(body.code).toBe('A->B: newest code from another editor');
  });

  it('returns not_found without writing when the content cannot be fetched', async () => {
    getById.mockResolvedValue(undefined);
    const result = await rename();
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns save_error with the thrown error when the PUT fails', async () => {
    const boom = Object.assign(new Error('403'), { status: 403 });
    update.mockRejectedValue(boom);
    const result = await rename();
    expect(result).toMatchObject({ ok: false, reason: 'save_error', error: boom });
  });

  it('returns id_mismatch when the PUT lands on a different custom content', async () => {
    update.mockResolvedValue({ ...existing, id: '111222333' });
    const result = await rename();
    expect(result).toMatchObject({ ok: false, reason: 'id_mismatch' });
  });

  it('rewrites the SWR content cache entry with the renamed doc and the attribution on success', async () => {
    putCachedContent('987654321', JSON.stringify(freshValue));
    const result = await rename('Checkout flow');
    expect(result.ok).toBe(true);
    const cached = getCachedContent('987654321');
    expect(cached).toBeDefined();
    expect(JSON.parse(cached!.doc)).toEqual({ ...freshValue, title: 'Checkout flow' });
    expect(cached!.attribution).toMatchObject({ customContentId: '987654321' });
  });

  it('leaves the SWR cache untouched on failure', async () => {
    putCachedContent('987654321', JSON.stringify(freshValue));
    update.mockRejectedValue(new Error('500'));
    await rename('Checkout flow');
    expect(JSON.parse(getCachedContent('987654321')!.doc).title).toBe('Login flow');
  });

  it('syncs the D1 mirror best-effort with the saved content and the macro localId', async () => {
    const saved = { ...existing, version: { number: 5 } };
    update.mockResolvedValue(saved);
    await rename();
    expect(sync).toHaveBeenCalledWith(saved, DiagramType.Sequence, 'local-uuid-1');
  });

  it('still succeeds when the D1 mirror sync throws', async () => {
    sync.mockRejectedValue(new Error('mirror down'));
    const result = await rename();
    expect(result.ok).toBe(true);
  });

  it('reports the fetch + write round-trip duration on both outcomes', async () => {
    const ok = await rename();
    expect(ok.ok).toBe(true);
    expect(typeof ok.durationMs).toBe('number');
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);

    update.mockRejectedValue(new Error('500'));
    const failed = await rename();
    expect(failed.ok).toBe(false);
    expect(typeof failed.durationMs).toBe('number');
  });
});
