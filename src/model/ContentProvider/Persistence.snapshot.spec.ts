import { saveToPlatform } from '@/model/ContentProvider/Persistence';
import { NULL_DIAGRAM, DiagramType } from '@/model/Diagram/Diagram';
import { vi } from 'vitest';
import ApWrapper2 from '../ApWrapper2';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import forgeGlobal from '@/model/globals/forgeGlobal';

// Snapshot module is entirely mocked here — Task 3 only cares that the save
// flow WIRES to it correctly (called with the right args, on the right
// diagram types, and never lets a snapshot failure fail the save). The
// module's own build/upload correctness is covered by SnapshotAttachment.spec.ts.
const { mockBuildSnapshot, mockUploadSnapshot, mockSnapshotAttachmentName, mockSnapshotSkipReason, mockSnapshotFailureDetail } = vi.hoisted(() => ({
  mockBuildSnapshot: vi.fn(),
  mockUploadSnapshot: vi.fn(),
  mockSnapshotAttachmentName: vi.fn((ccId: string) => `zenuml-${ccId}.json`),
  // Faithful stand-in for the real classifier (the module is fully mocked here):
  // 401/403 -> no_write_permission, 404 -> page_not_published, else undefined.
  mockSnapshotSkipReason: vi.fn((e: any) => {
    const m = /HTTP (\d{3})/.exec(String(e?.message ?? e));
    const s = m ? Number(m[1]) : e?.status;
    if (s === 401 || s === 403) return 'no_write_permission';
    if (s === 404) return 'page_not_published';
    return undefined;
  }),
  // Faithful stand-in for the real extract-then-truncate helper (#398) — the
  // module is fully mocked here, so this must mirror snapshotFailureDetail's
  // observable behavior closely enough to exercise Persistence's wiring to it.
  mockSnapshotFailureDetail: vi.fn((e: any) => {
    const raw = String(e?.message ?? e);
    let detail = raw;
    const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
    if (m?.[1]) detail = m[1];
    const cls = /(?:^|[.\s])([A-Za-z]+Exception)\b/.exec(detail)?.[1];
    return {
      failure_reason: detail.substring(0, 200),
      ...(cls ? { confluence_error_class: cls } : {}),
    };
  }),
}));

vi.mock('@/model/SnapshotAttachment', () => ({
  buildSnapshot: mockBuildSnapshot,
  uploadSnapshot: mockUploadSnapshot,
  snapshotAttachmentName: mockSnapshotAttachmentName,
  snapshotSkipReason: mockSnapshotSkipReason,
  snapshotFailureDetail: mockSnapshotFailureDetail,
}));

const mockSave = vi.fn(() => ({ id: 'mocked_custom_content_id', version: { number: 3 } }));

//@ts-ignore
const mockApWrapper: ApWrapper2 = {
  getMacroData: async () => ({ uuid: 'uuid_from_macro_data' }),
  _getCurrentPageId: vi.fn(() => Promise.resolve('host-page-1')),
};

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/services/CustomContent', () => ({
  syncCustomContent: vi.fn(),
}));

vi.mock('@/services/MacroMetrics', () => ({
  default: {
    reportMacroMetrics: vi.fn(() => Promise.resolve()),
    getMacroMetrics: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/model/ContentProvider/CustomContentStorageProvider', () => ({
  CustomContentStorageProvider: class CustomContentStorageProvider {
    save = mockSave;
  },
}));

describe('Persistence — snapshot save-path wiring (Task 3)', () => {
  beforeEach(() => {
    mockSave.mockClear();
    mockBuildSnapshot.mockReset();
    mockUploadSnapshot.mockReset();
    mockSnapshotFailureDetail.mockClear();
    vi.mocked(trackAnalyticsEvent).mockClear();
    (forgeGlobal as any).forgeContext = undefined;
  });

  it('uploads a snapshot for a mermaid save using the saved id + version', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'graph TD; A-->B', diagramType: DiagramType.Mermaid, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockUploadSnapshot.mockResolvedValue(undefined);

    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD; A-->B' }, mockApWrapper);

    expect(mockBuildSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ diagramType: DiagramType.Mermaid }),
      'mocked_custom_content_id',
      3,
    );
    expect(mockUploadSnapshot).toHaveBeenCalledWith('host-page-1', snapshot);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_created', expect.objectContaining({
      feature_area: 'macro',
      surface: 'editor',
      snapshot_trigger: 'save',
      custom_content_id: 'mocked_custom_content_id',
      attachment_name: 'zenuml-mocked_custom_content_id.json',
    }));
  });

  it('does NOT upload a snapshot for a graph save (buildSnapshot returns undefined — out of scope)', async () => {
    mockBuildSnapshot.mockReturnValue(undefined);

    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: '<x/>' }, mockApWrapper);

    expect(mockUploadSnapshot).not.toHaveBeenCalled();
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_created', expect.anything());
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });

  it('does NOT fail the save when uploadSnapshot throws — records snapshot_create_failed instead', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockUploadSnapshot.mockRejectedValue(new Error('boom'));

    const result = await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, mockApWrapper);

    expect(result).toBe('mocked_custom_content_id');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.objectContaining({
      feature_area: 'macro',
      surface: 'editor',
      snapshot_trigger: 'save',
      custom_content_id: 'mocked_custom_content_id',
      failure_reason: expect.stringContaining('boom'),
    }));
    // The pre-existing save success analytics must still fire — a snapshot
    // failure must never suppress the real save's own telemetry.
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('macro_create_succeeded', expect.anything());
  });

  it('a 404 on save (unpublished draft page) records snapshot_backfill_skipped, NOT a failure', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockUploadSnapshot.mockRejectedValue(new Error('snapshot upload HTTP 404: {"message":"NotFoundException: No content"}'));

    const result = await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, mockApWrapper);

    expect(result).toBe('mocked_custom_content_id');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_backfill_skipped', expect.objectContaining({
      surface: 'editor',
      snapshot_trigger: 'save',
      snapshot_skip_reason: 'page_not_published',
    }));
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });

  it('a 403 on save (app-auth write anomaly the editor permission cannot explain) stays snapshot_create_failed', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockUploadSnapshot.mockRejectedValue(new Error('snapshot upload HTTP 403: {"message":"PermissionException"}'));

    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, mockApWrapper);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.objectContaining({
      surface: 'editor', snapshot_trigger: 'save',
    }));
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('snapshot_backfill_skipped', expect.anything());
  });

  it('does NOT crash the save when the host page id is unavailable', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    const wrapperNoPageId = { ...mockApWrapper, _getCurrentPageId: vi.fn(() => Promise.reject(new Error('no page id'))) } as any;

    const result = await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, wrapperNoPageId);

    expect(result).toBe('mocked_custom_content_id');
    expect(mockUploadSnapshot).not.toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });

  // #398 (remaining site): Persistence.ts:152 built `failure_reason` with its
  // own `String(e.message).substring(0, 200)` instead of routing through
  // snapshotFailureDetail — the same envelope-eats-the-budget defect
  // SnapshotAttachment.ts already fixed. These assert the save path now
  // extracts the Confluence exception class BEFORE truncating, for both the
  // failure event and the skip event.
  const envelope = (status: number, cls: string, msg: string) =>
    new Error(
      `snapshot upload HTTP ${status}: ` +
        JSON.stringify({
          statusCode: status,
          data: { authorized: true, valid: true, errors: [], successful: true },
          message: `com.atlassian.confluence.api.service.exceptions.api.${cls}: ${msg}`,
        }),
    );

  it('a 403 on save keeps the Confluence exception class instead of the raw envelope', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockUploadSnapshot.mockRejectedValue(
      envelope(403, 'PermissionException', 'User not permitted to update attachment'),
    );

    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, mockApWrapper);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.objectContaining({
      surface: 'editor',
      snapshot_trigger: 'save',
      confluence_error_class: 'PermissionException',
      failure_reason: expect.stringContaining('User not permitted to update attachment'),
    }));
    const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'snapshot_create_failed');
    expect(call?.[1].failure_reason).not.toContain('statusCode');
  });

  it('a 404 on save keeps the Confluence exception class on the skip event', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockUploadSnapshot.mockRejectedValue(
      envelope(404, 'NotFoundException', 'No content found with id 12345'),
    );

    await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, mockApWrapper);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_backfill_skipped', expect.objectContaining({
      surface: 'editor',
      snapshot_trigger: 'save',
      snapshot_skip_reason: 'page_not_published',
      confluence_error_class: 'NotFoundException',
      failure_reason: expect.stringContaining('No content found with id 12345'),
    }));
  });
});
