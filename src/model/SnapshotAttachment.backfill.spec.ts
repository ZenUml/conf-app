import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramType } from './Diagram/Diagram';

// maybeBackfillSnapshot orchestrates fetchSnapshot/buildSnapshot/uploadSnapshot
// from THIS SAME module — mock the module's own transport-level exports
// (getAttachmentsV2 / requestConfluence) rather than the functions under test,
// so the real fetchSnapshot/buildSnapshot/uploadSnapshot logic (already
// covered by SnapshotAttachment.spec.ts) still runs for real here.
const { mockGetAttachmentsV2, mockRequestConfluence, mockTrackAnalyticsEvent } = vi.hoisted(() => ({
  mockGetAttachmentsV2: vi.fn(),
  mockRequestConfluence: vi.fn(),
  mockTrackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { getAttachmentsV2: mockGetAttachmentsV2 } },
}));

vi.mock('@forge/bridge', () => ({
  requestConfluence: mockRequestConfluence,
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
    mockTrackAnalyticsEvent.mockReset();
  });

  it('creates a snapshot on the host page for a cross-page alias with no existing snapshot', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]); // fetchSnapshot: nothing exists yet
    mockRequestConfluence.mockResolvedValue({ ok: true, status: 200 }); // uploadSnapshot PUT

    await maybeBackfillSnapshot(baseOpts());

    // fetchSnapshot's getAttachmentsV2 GET, then uploadSnapshot's PUT.
    expect(mockGetAttachmentsV2).toHaveBeenCalledWith('host-page', { filename: 'zenuml-12345.json' });
    expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
    const [url, init] = mockRequestConfluence.mock.calls[0];
    expect(url).toContain('/wiki/rest/api/content/host-page/child/attachment');
    expect(init.method).toBe('PUT');
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_created', expect.objectContaining({
      feature_area: 'macro', surface: 'editor', snapshot_trigger: 'editor_backfill', custom_content_id: '12345',
    }));
  });

  it('skips entirely in display mode (viewer/fullscreen — write perms not guaranteed)', async () => {
    await maybeBackfillSnapshot(baseOpts({ isDisplayMode: true }));
    expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
    expect(mockRequestConfluence).not.toHaveBeenCalled();
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('skips when the macro is on the same page as the custom content (no alias)', async () => {
    await maybeBackfillSnapshot(baseOpts({ ccPageId: 'host-page' }));
    expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
    expect(mockRequestConfluence).not.toHaveBeenCalled();
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
    mockRequestConfluence.mockImplementation((url: string) => {
      if (url.includes('/download/')) return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(existingSnapshot)) });
      return Promise.resolve({ ok: true, status: 200 });
    });

    await maybeBackfillSnapshot(baseOpts({ ccVersion: 5 }));

    // Only the fetchSnapshot GET/download round trip — no upload PUT.
    expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
    expect(mockRequestConfluence.mock.calls[0][0]).toContain('/download/');
  });

  it('updates when the existing snapshot is staler than the current CC version', async () => {
    const staleSnapshot = {
      version: 1, ccId: '12345', ccVersion: 2, diagramType: DiagramType.Mermaid,
      dsl: 'graph TD; A-->old', snapshotAt: '2026-06-01T00:00:00.000Z',
    };
    mockGetAttachmentsV2.mockResolvedValue([{ _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockImplementation((url: string) => {
      if (url.includes('/download/')) return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(staleSnapshot)) });
      return Promise.resolve({ ok: true, status: 200 });
    });

    await maybeBackfillSnapshot(baseOpts({ ccVersion: 5 }));

    expect(mockRequestConfluence).toHaveBeenCalledTimes(2); // download check + PUT
    const putCall = mockRequestConfluence.mock.calls.find(c => c[1]?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith('snapshot_created', expect.anything());
  });

  it('never throws — a transport failure resolves to snapshot_create_failed', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockRequestConfluence.mockResolvedValue({ ok: false, status: 500 });

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
    expect(mockTrackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
