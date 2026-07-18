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
const { mockBuildSnapshot, mockUploadSnapshot, mockSnapshotAttachmentName } = vi.hoisted(() => ({
  mockBuildSnapshot: vi.fn(),
  mockUploadSnapshot: vi.fn(),
  mockSnapshotAttachmentName: vi.fn((ccId: string) => `zenuml-${ccId}.json`),
}));

vi.mock('@/model/SnapshotAttachment', () => ({
  buildSnapshot: mockBuildSnapshot,
  uploadSnapshot: mockUploadSnapshot,
  snapshotAttachmentName: mockSnapshotAttachmentName,
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

  it('does NOT crash the save when the host page id is unavailable', async () => {
    const snapshot = { version: 1, ccId: 'mocked_custom_content_id', dsl: 'A.method()', diagramType: DiagramType.Sequence, snapshotAt: 'now' };
    mockBuildSnapshot.mockReturnValue(snapshot);
    const wrapperNoPageId = { ...mockApWrapper, _getCurrentPageId: vi.fn(() => Promise.reject(new Error('no page id'))) } as any;

    const result = await saveToPlatform({ ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()' }, wrapperNoPageId);

    expect(result).toBe('mocked_custom_content_id');
    expect(mockUploadSnapshot).not.toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_create_failed', expect.anything());
  });
});
