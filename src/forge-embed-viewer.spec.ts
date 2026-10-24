import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';

const h = vi.hoisted(() => ({
  context: {} as any,
  loadCustomContentWithOrphanRecovery: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/Attachment', () => ({ default: vi.fn() }));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      loadCustomContentWithOrphanRecovery: h.loadCustomContentWithOrphanRecovery,
      findLegacyCustomContentByUuid: vi.fn(),
      isDisplayMode: vi.fn(() => false),
      canUserEdit: vi.fn(() => false),
    },
  },
}));
vi.mock('@/model/globals/forgeGlobal', () => ({
  getContext: vi.fn(async () => h.context),
  openModal: vi.fn(),
}));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}));
vi.mock('@/utils/orphanTelemetry', () => ({ reportOrphanObserved: vi.fn() }));
vi.mock('@/utils/viewerBootstrap', () => ({ bootstrapForgeViewer: vi.fn() }));
vi.mock('./EventBus', () => ({ default: { $on: vi.fn() } }));

import { loadDiagram } from './forge-embed-viewer';

const CLOUD_ID = '494a0c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const CONTENT_ID = '123456789';
const BASE_PROPS = {
  feature_area: 'macro',
  surface: 'viewer',
  macro_type: 'embed',
  source: 'autoconvert_link',
} as const;

describe('Embed AutoConvert analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.context = {
      cloudId: CLOUD_ID,
      extension: {
        content: { id: 'page-1' },
        config: {},
        autoConvertLink: `https://confluence.zenuml.com/d/${CLOUD_ID}/${CONTENT_ID}`,
      },
    };
  });

  it('records detection and target resolution for a same-tenant link', async () => {
    const diagram = { diagramType: DiagramType.Sequence, code: 'A->B: hi' } as Diagram;
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({ customContent: { value: diagram } });

    await expect(loadDiagram()).resolves.toEqual({ doc: diagram, loadError: null });

    expect(h.trackAnalyticsEvent.mock.calls).toEqual([
      ['embed_autoconvert_detected', {
        ...BASE_PROPS,
        custom_content_id: CONTENT_ID,
        is_same_site: true,
      }],
      ['embed_autoconvert_target_resolved', {
        ...BASE_PROPS,
        custom_content_id: CONTENT_ID,
        is_same_site: true,
      }],
    ]);
  });

  it('records an invalid autoconvert link as a terminal failure', async () => {
    h.context.extension.autoConvertLink =
      `https://confluence.zenuml.com/d/${CLOUD_ID}/not-numeric`;

    await expect(loadDiagram()).resolves.toEqual({ doc: undefined, loadError: null });

    expect(h.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
    expect(h.trackAnalyticsEvent.mock.calls).toEqual([
      ['embed_autoconvert_detected', BASE_PROPS],
      ['embed_autoconvert_failed', {
        ...BASE_PROPS,
        failure_reason: 'invalid_url',
      }],
    ]);
  });

  it('records missing custom content as a terminal failure, with a structured loadError', async () => {
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({
      customContent: undefined,
      directFetchStatus: 'not_found',
    });

    await expect(loadDiagram()).resolves.toEqual({
      doc: undefined,
      loadError: {
        directFetchStatus: 'not_found',
        httpStatus: undefined,
        errorCode: undefined,
        errorClass: undefined,
      },
    });

    expect(h.trackAnalyticsEvent.mock.calls).toEqual([
      ['embed_autoconvert_detected', {
        ...BASE_PROPS,
        custom_content_id: CONTENT_ID,
        is_same_site: true,
      }],
      ['embed_autoconvert_failed', {
        ...BASE_PROPS,
        custom_content_id: CONTENT_ID,
        is_same_site: true,
        failure_reason: 'target_missing',
      }],
    ]);
  });

  // loadCustomContentWithOrphanRecovery classifies failures into its return
  // shape rather than throwing (same contract every other caller in this
  // codebase relies on) — unlike the old bare getCustomContentByIdV2 call,
  // there is no thrown-fetch path left to distinguish with a 'fetch_failed'
  // reason. A fetch failure now surfaces exactly like the previous test:
  // customContent stays undefined and it reports as 'target_missing'.

  it('records cross-tenant rejection as the sole terminal event and never fetches', async () => {
    const foreignCloudId = '11111111-2222-3333-4444-555555555555';
    h.context.extension.autoConvertLink =
      `https://confluence.zenuml.com/d/${foreignCloudId}/${CONTENT_ID}`;

    await expect(loadDiagram()).resolves.toEqual({ doc: undefined, loadError: null });

    expect(h.loadCustomContentWithOrphanRecovery).not.toHaveBeenCalled();
    const props = {
      ...BASE_PROPS,
      custom_content_id: CONTENT_ID,
      is_same_site: false,
    };
    expect(h.trackAnalyticsEvent.mock.calls).toEqual([
      ['embed_autoconvert_detected', props],
      ['embed_autoconvert_cross_tenant_rejected', props],
    ]);
  });

  it('does not emit autoconvert events for an ordinary configured embed', async () => {
    const diagram = { diagramType: DiagramType.Sequence, code: 'A->B: hi' } as Diagram;
    h.context.extension.config.customContentId = CONTENT_ID;
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({ customContent: { value: diagram } });

    await expect(loadDiagram()).resolves.toEqual({ doc: diagram, loadError: null });

    expect(h.loadCustomContentWithOrphanRecovery).toHaveBeenCalledWith('page-1', CONTENT_ID);
    expect(h.trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
