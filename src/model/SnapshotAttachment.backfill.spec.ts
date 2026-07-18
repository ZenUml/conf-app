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

  it('skips entirely in display mode (viewer/fullscreen — write perms not guaranteed)', async () => {
    await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true }));
    expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
    expect(mockRequestConfluence).not.toHaveBeenCalled();
    expect(mockCallRemote).not.toHaveBeenCalled();
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('skips when the macro is on the same page as the custom content (no alias)', async () => {
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
});
