import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';

const h = vi.hoisted(() => ({
  context: {} as any,
  getCustomContentByIdV2: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getCustomContentByIdV2: h.getCustomContentByIdV2,
      findLegacyCustomContentByUuid: vi.fn(),
      isDisplayMode: vi.fn(() => false),
      canUserEdit: vi.fn(() => false),
    },
  },
}));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}));
vi.mock('@/utils/orphanTelemetry', () => ({ reportOrphanObserved: vi.fn() }));

import { embedViewerAdapter } from '@/utils/viewerAdapters/embedViewerAdapter';

const CLOUD_ID = '494a0c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const CONTENT_ID = '123456789';
const BASE_PROPS = {
  feature_area: 'macro',
  surface: 'viewer',
  macro_type: 'embed',
  source: 'autoconvert_link',
} as const;

async function resolveAndLoad() {
  const resolution = await embedViewerAdapter.resolve(h.context);
  const doc = resolution.status === 'loadable'
    ? await embedViewerAdapter.load(resolution.target)
    : undefined;
  return { resolution, doc };
}

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

  it('records detection and successful resolution for a same-tenant link', async () => {
    const diagram = { diagramType: DiagramType.Sequence, code: 'A->B: hi' } as Diagram;
    h.getCustomContentByIdV2.mockResolvedValue({ value: diagram });

    const { resolution, doc } = await resolveAndLoad();

    expect(doc).toBe(diagram);
    expect(resolution).toMatchObject({
      status: 'loadable',
      target: { customContentId: CONTENT_ID },
      cacheIdentity: {
        cloudId: CLOUD_ID,
        customContentId: CONTENT_ID,
        macroKind: 'embed',
      },
    });

    expect(h.trackAnalyticsEvent.mock.calls).toEqual([
      ['embed_autoconvert_detected', {
        ...BASE_PROPS,
        custom_content_id: CONTENT_ID,
        is_same_site: true,
      }],
      ['embed_autoconvert_succeeded', {
        ...BASE_PROPS,
        custom_content_id: CONTENT_ID,
        is_same_site: true,
      }],
    ]);
  });

  it('records an invalid autoconvert link as a terminal failure', async () => {
    h.context.extension.autoConvertLink =
      `https://confluence.zenuml.com/d/${CLOUD_ID}/not-numeric`;

    const { resolution, doc } = await resolveAndLoad();

    expect(doc).toBeUndefined();
    expect(resolution).toEqual({ status: 'empty', reason: 'invalid_target' });

    expect(h.getCustomContentByIdV2).not.toHaveBeenCalled();
    expect(h.trackAnalyticsEvent.mock.calls).toEqual([
      ['embed_autoconvert_detected', BASE_PROPS],
      ['embed_autoconvert_failed', {
        ...BASE_PROPS,
        failure_reason: 'invalid_link',
      }],
    ]);
  });

  it('records missing custom content as a terminal failure', async () => {
    h.getCustomContentByIdV2.mockResolvedValue(undefined);

    const { doc } = await resolveAndLoad();

    expect(doc).toBeUndefined();

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
        failure_reason: 'content_not_found',
      }],
    ]);
  });

  it('records a thrown custom-content fetch and preserves the error', async () => {
    const error = new Error('Confluence request failed');
    h.getCustomContentByIdV2.mockRejectedValue(error);

    const resolution = await embedViewerAdapter.resolve(h.context);
    expect(resolution.status).toBe('loadable');
    if (resolution.status !== 'loadable') throw new Error('expected loadable target');
    await expect(embedViewerAdapter.load(resolution.target)).rejects.toBe(error);

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
        failure_reason: 'fetch_failed',
      }],
    ]);
  });

  it('records cross-tenant rejection as the sole terminal event and never fetches', async () => {
    const foreignCloudId = '11111111-2222-3333-4444-555555555555';
    h.context.extension.autoConvertLink =
      `https://confluence.zenuml.com/d/${foreignCloudId}/${CONTENT_ID}`;

    const { resolution, doc } = await resolveAndLoad();

    expect(doc).toBeUndefined();
    expect(resolution).toEqual({ status: 'empty', reason: 'cross_tenant' });

    expect(h.getCustomContentByIdV2).not.toHaveBeenCalled();
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
    h.getCustomContentByIdV2.mockResolvedValue({ value: diagram });

    const { doc } = await resolveAndLoad();

    expect(doc).toBe(diagram);

    expect(h.getCustomContentByIdV2).toHaveBeenCalledWith(CONTENT_ID);
    expect(h.trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
