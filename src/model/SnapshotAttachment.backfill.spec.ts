import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramType } from './Diagram/Diagram';

// maybeBackfillSnapshot orchestrates fetchSnapshot/buildSnapshot/uploadSnapshot
// from THIS SAME module — mock the module's own transport-level exports
// (getAttachmentsV2 / requestConfluence / callRemote) rather than the
// functions under test, so the real fetchSnapshot/buildSnapshot/uploadSnapshot
// logic (already covered by SnapshotAttachment.spec.ts) still runs for real
// here. requestConfluence remains for fetchSnapshot's download GET; callRemote
// is uploadSnapshot's transport to the /forge-upload-attachment backend.
const { mockGetAttachmentsV2, mockRequestConfluence, mockCallRemote, mockTrackAnalyticsEvent } = vi.hoisted(() => ({
  mockGetAttachmentsV2: vi.fn(),
  mockRequestConfluence: vi.fn(),
  mockCallRemote: vi.fn(),
  mockTrackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { getAttachmentsV2: mockGetAttachmentsV2 } },
}));

vi.mock('@forge/bridge', () => ({
  requestConfluence: mockRequestConfluence,
}));

vi.mock('@/utils/requestUtil', () => ({
  callRemote: mockCallRemote,
}));

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: mockTrackAnalyticsEvent,
}));

import { maybeBackfillSnapshot } from './SnapshotAttachment';

const diagram = { diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD; A-->B', title: 'T' } as any;

function baseOpts(overrides: Partial<Parameters<typeof maybeBackfillSnapshot>[0]> = {}) {
  return {
    hostPageId: 'host-page',
    ccId: '12345',
    ccPageId: 'source-page',
    diagram,
    ccVersion: 5,
    isDisplayMode: false,
    ...overrides,
  };
}

describe('maybeBackfillSnapshot', () => {
  beforeEach(() => {
    mockGetAttachmentsV2.mockReset();
    mockRequestConfluence.mockReset();
    mockCallRemote.mockReset();
    mockTrackAnalyticsEvent.mockReset();
    // The #387 denial memo persists in localStorage across calls by design —
    // clear it between tests so one test's confirmed denial can't leak into
    // another test's assertions about a fresh page.
    window.localStorage.clear();
  });

  it('creates a snapshot on the host page for a cross-page alias with no existing snapshot', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]); // fetchSnapshot AND uploadSnapshot's existence check: nothing exists yet
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-new-1', versionNumber: 1 }); // uploadSnapshot's backend call

    await maybeBackfillSnapshot(baseOpts());

    // fetchSnapshot's getAttachmentsV2 GET, then uploadSnapshot's backend call
    // (never requestConfluence — the v1 child/attachment endpoint 404s through
    // the Forge client proxy regardless of verb; see SnapshotAttachment.uploadSnapshot).
    expect(mockGetAttachmentsV2).toHaveBeenCalledWith('host-page', { filename: 'zenuml-12345.json' });
    expect(mockCallRemote).toHaveBeenCalledTimes(1);
    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.objectContaining({
      pageId: 'host-page',
      attachmentName: 'zenuml-12345.json',
      contentType: 'application/json',
    }));
    expect(mockRequestConfluence).not.toHaveBeenCalled();
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_created', expect.objectContaining({
      feature_area: 'macro', surface: 'editor', snapshot_trigger: 'editor_backfill', custom_content_id: '12345',
    }));
  });

  // Viewer surface (isDisplayMode: true, covers plain page-view AND fullscreen
  // — ApWrapper2.isDisplayMode() returns true for both): the new-page recovery
  // case. A macro created on a brand-new page is saved BEFORE the page is
  // published, so the save-time attachment write 404s (Persistence.ts / the
  // PNG's Attachment.ts document this same benign 404). The page IS published
  // by the time it's viewed, and uploadSnapshot routes through the
  // app-authenticated backend (/forge-upload-attachment, PR #353), so
  // viewer-user write permission is not required. Unlike the editor surface,
  // this covers ANY macro — same-page included — not just cross-page aliases.
  it('viewer surface backfills a same-page macro with no existing snapshot', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]); // fetchSnapshot AND uploadSnapshot's existence check: nothing exists yet
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-new-2', versionNumber: 1 });

    await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' })); // same page as host — no alias

    expect(mockGetAttachmentsV2).toHaveBeenCalledWith('host-page', { filename: 'zenuml-12345.json' });
    expect(mockCallRemote).toHaveBeenCalledTimes(1);
    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.objectContaining({
      pageId: 'host-page',
      attachmentName: 'zenuml-12345.json',
    }));
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_created', expect.objectContaining({
      feature_area: 'macro', surface: 'viewer', snapshot_trigger: 'viewer_backfill', custom_content_id: '12345',
    }));
  });

  it('viewer surface skips (no upload) when a fresh snapshot already exists', async () => {
    const existingSnapshot = {
      version: 1, ccId: '12345', ccVersion: 5, diagramType: DiagramType.Mermaid,
      dsl: 'graph TD; A-->B', snapshotAt: '2026-07-01T00:00:00.000Z',
    };
    mockGetAttachmentsV2.mockResolvedValue([{ _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(existingSnapshot)) });

    await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page', ccVersion: 5 }));

    expect(mockCallRemote).not.toHaveBeenCalled();
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('viewer surface never throws — a transport failure resolves to snapshot_create_failed', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: false, status: 500, body: 'boom' });

    await expect(maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }))).resolves.toBeUndefined();
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.objectContaining({
      feature_area: 'macro', surface: 'viewer', snapshot_trigger: 'viewer_backfill', custom_content_id: '12345',
      failure_reason: expect.stringContaining('500'),
    }));
  });

  // A read-only viewer with no attachment-write permission: the app-auth upload
  // is denied (403). This is the EXPECTED best-effort outcome (see the module
  // header / #211/#162) — record it as a skip, NOT snapshot_create_failed, so
  // that event stays a genuine error signal.
  it('viewer surface: a 403 permission denial resolves to snapshot_backfill_skipped (no_write_permission), not a failure', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: false, status: 403, body: '{"statusCode":403,"message":"PermissionException"}' });

    await expect(maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }))).resolves.toBeUndefined();
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_backfill_skipped', expect.objectContaining({
      feature_area: 'macro', surface: 'viewer', snapshot_trigger: 'viewer_backfill', custom_content_id: '12345',
      snapshot_skip_reason: 'no_write_permission',
    }));
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });

  it('viewer surface: a 401 (missing user token) is also an expected no_write_permission skip', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: false, status: 401, body: 'missing x-forge-oauth-user header' });

    await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_backfill_skipped', expect.objectContaining({
      snapshot_skip_reason: 'no_write_permission', surface: 'viewer',
    }));
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });

  // A macro on a page that isn't published yet: the app-auth upload 404s
  // (NotFoundException on the parent content). Benign draft case — a skip.
  it('viewer surface: a 404 (unpublished draft page) resolves to snapshot_backfill_skipped (page_not_published)', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: false, status: 404, body: '{"statusCode":404,"message":"NotFoundException: No content"}' });

    await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_backfill_skipped', expect.objectContaining({
      snapshot_skip_reason: 'page_not_published', surface: 'viewer',
    }));
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });

  // Editor surface (isDisplayMode: false) keeps its ORIGINAL restriction:
  // cross-page aliases only. A same-page macro already gets a snapshot at
  // save time on every save after the first successful one, so an editor
  // preview render of a same-page macro must NOT re-upload.
  it('editor surface still skips when the macro is on the same page as the custom content (no alias) — unchanged', async () => {
    await maybeBackfillSnapshot(baseOpts({ ccPageId: 'host-page' }));
    expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
    expect(mockRequestConfluence).not.toHaveBeenCalled();
    expect(mockCallRemote).not.toHaveBeenCalled();
  });

  it('skips when ccPageId is missing (cannot tell if this is a cross-page alias)', async () => {
    await maybeBackfillSnapshot(baseOpts({ ccPageId: undefined }));
    expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
  });

  it('skips when a snapshot already exists at least as fresh as the current CC version', async () => {
    const existingSnapshot = {
      version: 1, ccId: '12345', ccVersion: 5, diagramType: DiagramType.Mermaid,
      dsl: 'graph TD; A-->B', snapshotAt: '2026-07-01T00:00:00.000Z',
    };
    mockGetAttachmentsV2.mockResolvedValue([{ _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(existingSnapshot)) });

    await maybeBackfillSnapshot(baseOpts({ ccVersion: 5 }));

    // Only the fetchSnapshot GET/download round trip — no backend upload call.
    expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
    expect(mockRequestConfluence.mock.calls[0][0]).toContain('/download/');
    expect(mockCallRemote).not.toHaveBeenCalled();
  });

  it('updates when the existing snapshot is staler than the current CC version', async () => {
    const staleSnapshot = {
      version: 1, ccId: '12345', ccVersion: 2, diagramType: DiagramType.Mermaid,
      dsl: 'graph TD; A-->old', snapshotAt: '2026-06-01T00:00:00.000Z',
    };
    // Same getAttachmentsV2 result feeds BOTH fetchSnapshot's staleness check
    // and uploadSnapshot's existence lookup — id 'att-7' means the latter
    // targets an update, not a duplicate create.
    mockGetAttachmentsV2.mockResolvedValue([{ id: 'att-7', _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(staleSnapshot)) });
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-7', versionNumber: 1 });

    await maybeBackfillSnapshot(baseOpts({ ccVersion: 5 }));

    expect(mockRequestConfluence).toHaveBeenCalledTimes(1); // fetchSnapshot's download check only
    expect(mockCallRemote).toHaveBeenCalledTimes(1);
    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.objectContaining({
      attachmentId: 'att-7', // existing attachment -> update, not a duplicate create
    }));
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_created', expect.anything());
  });

  it('never throws — a transport failure resolves to snapshot_create_failed', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: false, status: 500, body: 'boom' });

    await expect(maybeBackfillSnapshot(baseOpts())).resolves.toBeUndefined();
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.objectContaining({
      feature_area: 'macro', surface: 'editor', snapshot_trigger: 'editor_backfill', custom_content_id: '12345',
      failure_reason: expect.stringContaining('500'),
    }));
  });

  it('skips (no upload, no event) when the diagram type is out of snapshot scope', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    await maybeBackfillSnapshot(baseOpts({ diagram: { diagramType: DiagramType.Graph, graphXml: '<x/>' } as any }));
    expect(mockRequestConfluence).not.toHaveBeenCalled();
    expect(mockCallRemote).not.toHaveBeenCalled();
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalled();
  });

  // #387: viewer_backfill flooded snapshot_create_failed (later reclassified
  // to snapshot_backfill_skipped by fa29db93/dfe0f9a3) because a page whose
  // app-authenticated write is denied gets re-attempted — and re-403s — on
  // EVERY view, forever. The fix is a negative memo (denialMemo.ts): after the
  // first confirmed 401/403 on a page, later viewer-surface calls for that
  // same page must stop attempting the write at all.
  describe('#387 denial memo — viewer surface only stops re-attempting a known-denied page', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('a 403 on the first view attempts the write once; a second view of the same page attempts nothing', async () => {
      mockGetAttachmentsV2.mockResolvedValue([]);
      mockCallRemote.mockResolvedValue({ ok: false, status: 403, body: '{"statusCode":403,"message":"PermissionException"}' });

      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
      expect(mockCallRemote).toHaveBeenCalledTimes(1); // the confirming attempt
      expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_backfill_skipped', expect.objectContaining({
        snapshot_skip_reason: 'no_write_permission',
      }));

      mockGetAttachmentsV2.mockClear();
      mockCallRemote.mockClear();
      mockTrackAnalyticsEvent.mockClear();

      // Second view of the SAME page: on origin/main (no memo) this repeats
      // the fetchSnapshot GET + the 403'ing upload attempt — the exact
      // repeat-attempt flood #387 reports. With the memo, nothing is attempted.
      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
      expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
      expect(mockCallRemote).not.toHaveBeenCalled();
      expect(mockTrackAnalyticsEvent).not.toHaveBeenCalled();
    });

    it('a 401 on the first view also memoes — the second view attempts nothing', async () => {
      mockGetAttachmentsV2.mockResolvedValue([]);
      mockCallRemote.mockResolvedValue({ ok: false, status: 401, body: 'missing x-forge-oauth-user header' });

      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
      mockCallRemote.mockClear();

      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
      expect(mockCallRemote).not.toHaveBeenCalled();
    });

    it('a 404 (unpublished draft) does NOT memo — the second view retries, matching the new-page recovery design', async () => {
      mockGetAttachmentsV2.mockResolvedValue([]);
      mockCallRemote.mockResolvedValue({ ok: false, status: 404, body: '{"statusCode":404,"message":"NotFoundException: No content"}' });

      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
      mockGetAttachmentsV2.mockClear();
      mockCallRemote.mockClear();

      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));
      expect(mockCallRemote).toHaveBeenCalledTimes(1); // retried, not memoed
    });

    it('a denial on one page does not memo a different page', async () => {
      mockGetAttachmentsV2.mockResolvedValue([]);
      mockCallRemote.mockResolvedValue({ ok: false, status: 403, body: '{"statusCode":403,"message":"PermissionException"}' });
      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page', hostPageId: 'host-page' }));
      mockCallRemote.mockClear();

      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'other-page', hostPageId: 'other-page' }));
      expect(mockCallRemote).toHaveBeenCalledTimes(1); // different page, not memoed
    });

    it('the editor surface is unaffected by a viewer-surface denial memo on the same page', async () => {
      mockGetAttachmentsV2.mockResolvedValue([]);
      mockCallRemote.mockResolvedValue({ ok: false, status: 403, body: '{"statusCode":403,"message":"PermissionException"}' });
      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true, ccPageId: 'host-page' }));

      mockGetAttachmentsV2.mockClear();
      mockCallRemote.mockClear();
      mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-1', versionNumber: 1 });

      // Editor surface, cross-page alias — must still attempt (editor writes
      // don't go through the viewer denial memo).
      await maybeBackfillSnapshot(baseOpts({ isDisplayMode: false, ccPageId: 'source-page', hostPageId: 'host-page' }));
      expect(mockCallRemote).toHaveBeenCalledTimes(1);
    });
  });
});
