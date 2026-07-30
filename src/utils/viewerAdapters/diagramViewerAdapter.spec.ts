import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, DiagramType, type Diagram } from '@/model/Diagram/Diagram';

const h = vi.hoisted(() => ({
  loadCustomContentWithOrphanRecovery: vi.fn(),
  getContentPropertyV2: vi.fn(),
  findLegacyCustomContentByUuid: vi.fn(),
  isDisplayMode: vi.fn(() => true),
  reportOrphanObserved: vi.fn(),
  reportLegacyRestored: vi.fn(),
  reportLegacyLoadFailed: vi.fn(),
  reportLegacyValueUnexpected: vi.fn(),
  maybeBackfillSnapshot: vi.fn(),
  fetchSnapshot: vi.fn(),
  snapshotToDiagram: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      loadCustomContentWithOrphanRecovery: h.loadCustomContentWithOrphanRecovery,
      getContentPropertyV2: h.getContentPropertyV2,
      findLegacyCustomContentByUuid: h.findLegacyCustomContentByUuid,
      isDisplayMode: h.isDisplayMode,
    },
  },
}));
vi.mock('@/utils/orphanTelemetry', () => ({
  reportOrphanObserved: h.reportOrphanObserved,
}));
vi.mock('@/utils/legacyContentPropertyTelemetry', () => ({
  reportLegacyContentPropertyRestored: h.reportLegacyRestored,
  reportLegacyContentPropertyLoadFailed: h.reportLegacyLoadFailed,
  reportLegacyContentPropertyValueUnexpected: h.reportLegacyValueUnexpected,
}));
vi.mock('@/model/SnapshotAttachment', () => ({
  maybeBackfillSnapshot: h.maybeBackfillSnapshot,
  fetchSnapshot: h.fetchSnapshot,
  snapshotToDiagram: h.snapshotToDiagram,
}));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}));
vi.mock('@/utils/window', () => ({ trackEvent: h.trackEvent }));

import { diagramViewerAdapter } from '@/utils/viewerAdapters/diagramViewerAdapter';

describe('diagramViewerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getContentPropertyV2.mockResolvedValue({ status: 'not_found' });
    h.findLegacyCustomContentByUuid.mockResolvedValue(undefined);
    h.fetchSnapshot.mockResolvedValue(undefined);
  });

  it('resolves the saved id and config.uuid without consulting localId', async () => {
    await expect(diagramViewerAdapter.resolve({
      cloudId: 'cloud-a',
      localId: 'must-not-be-used',
      extension: {
        config: { customContentId: 'cc-1', uuid: 'storage-uuid' },
        content: { id: 'page-1' },
      },
    })).resolves.toEqual({
      status: 'loadable',
      target: {
        customContentId: 'cc-1',
        storageUuid: 'storage-uuid',
        pageId: 'page-1',
      },
      cacheIdentity: {
        cloudId: 'cloud-a',
        customContentId: 'cc-1',
        macroKind: 'sequence',
      },
    });
  });

  it('uses a modal id but disables cache publication for fullscreen', async () => {
    await expect(diagramViewerAdapter.resolve({
      cloudId: 'cloud-a',
      extension: {
        config: {},
        modal: { customContentId: 'cc-modal', macroMode: 'fullscreen' },
      },
    })).resolves.toEqual({
      status: 'loadable',
      target: {
        customContentId: 'cc-modal',
        storageUuid: undefined,
        pageId: undefined,
      },
      cacheIdentity: undefined,
    });
  });

  it('keeps a uuid-only legacy viewer loadable and makes a missing target explicit', async () => {
    await expect(diagramViewerAdapter.resolve({
      cloudId: 'cloud-a',
      localId: 'not-storage',
      extension: { config: { uuid: 'storage-uuid' } },
    })).resolves.toMatchObject({
      status: 'loadable',
      target: { storageUuid: 'storage-uuid' },
      cacheIdentity: undefined,
    });

    await expect(diagramViewerAdapter.resolve({ extension: { config: {} } }))
      .resolves.toEqual({ status: 'empty', reason: 'missing_target' });
  });

  it('normalizes an object-shaped legacy Mermaid body before publication', async () => {
    h.getContentPropertyV2.mockResolvedValue({
      status: 'ok',
      property: { value: { mermaidCode: 'graph TD; A-->B' } },
    });

    const doc = await diagramViewerAdapter.load({
      storageUuid: 'storage-uuid',
      pageId: 'page-1',
    });

    expect(doc).toMatchObject({
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'graph TD; A-->B',
      source: DataSource.ContentProperty,
      recoveredFromOrphan: true,
    });
    expect(h.reportLegacyRestored).toHaveBeenCalledWith(
      'viewer', 'sequence', 'storage-uuid', { pageId: 'page-1' },
    );
  });

  it('backfills PlantUML only at the publication boundary', () => {
    const raw = { diagramType: DiagramType.Sequence, code: 'A->B' } as Diagram;

    const published = diagramViewerAdapter.normalize?.(raw);

    expect(raw.plantUmlCode).toBeUndefined();
    expect(published?.plantUmlCode).toContain('@startuml');
  });

  it('preserves the custom-content, legacy-property, uuid and snapshot fallback order', async () => {
    const order: string[] = [];
    h.loadCustomContentWithOrphanRecovery.mockImplementation(async () => {
      order.push('custom-content');
      return { customContent: undefined, probeResult: { recoverable: false } };
    });
    h.getContentPropertyV2.mockImplementation(async () => {
      order.push('content-property');
      return { status: 'not_found' };
    });
    h.findLegacyCustomContentByUuid.mockImplementation(async () => {
      order.push('uuid-content');
      return undefined;
    });
    const restored = {
      diagramType: DiagramType.Sequence,
      code: 'A->B: from snapshot',
      snapshotFallback: true,
    } as Diagram;
    h.fetchSnapshot.mockImplementation(async () => {
      order.push('snapshot');
      return { version: 1, diagramType: 'sequence', dsl: restored.code };
    });
    h.snapshotToDiagram.mockReturnValue(restored);

    const doc = await diagramViewerAdapter.load({
      customContentId: 'cc-1',
      storageUuid: 'storage-uuid',
      pageId: 'page-1',
    });

    expect(order).toEqual(['custom-content', 'content-property', 'uuid-content', 'snapshot']);
    expect(doc).toMatchObject(restored);
    expect(h.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith(
      'page-1', 'cc-1', { copyCheckMode: 'cross-page-only' },
    );
    expect(h.trackAnalyticsEvent).toHaveBeenCalledWith('snapshot_fallback_rendered',
      expect.objectContaining({ surface: 'viewer', custom_content_id: 'cc-1' }));
  });

  it('marks an orphan recovery and schedules snapshot backfill from the fresh record', async () => {
    const doc = { diagramType: DiagramType.PlantUml, plantUmlCode: '@startuml\n@enduml' } as Diagram;
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({
      customContent: { id: 'cc-recovered', pageId: 'source-page', version: { number: 7 }, value: doc },
      recoveredFromOrphanId: 'cc-dead',
      probeResult: { recoverable: true },
    });

    const loaded = await diagramViewerAdapter.load({
      customContentId: 'cc-dead',
      pageId: 'host-page',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loaded).toMatchObject({
      diagramType: DiagramType.PlantUml,
      recoveredFromOrphan: true,
      recoveredFromOrphanId: 'cc-dead',
    });
    expect(h.reportOrphanObserved).toHaveBeenCalledWith(
      'host-page', 'cc-dead', 'sequence', { recoverable: true },
      { recoveryUsed: true, recoveredId: 'cc-recovered' },
    );
    expect(h.maybeBackfillSnapshot).toHaveBeenCalledWith({
      hostPageId: 'host-page',
      ccId: 'cc-dead',
      ccPageId: 'source-page',
      diagram: doc,
      ccVersion: 7,
      isDisplayMode: true,
    });
  });
});
