import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSequenceFamilyEntry } from './macroEntryRouting';
import { trackEvent } from '@/utils/window';

const h = vi.hoisted(() => ({
  context: {} as any,
  loadCustomContentWithOrphanRecovery: vi.fn(),
  bootstrapForgeViewer: vi.fn(async () => undefined),
  ensureDrawioViewerLoaded: vi.fn(async () => undefined),
}));

vi.mock('@/utils/window', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/window')>(),
  trackEvent: vi.fn(),
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
vi.mock('@/utils/viewerBootstrap', () => ({
  bootstrapForgeViewer: h.bootstrapForgeViewer,
}));
vi.mock('@/utils/drawio/loadDrawioViewer', () => ({
  ensureDrawioViewerLoaded: h.ensureDrawioViewerLoaded,
}));
vi.mock('@/EventBus', () => ({ default: { $on: vi.fn() } }));

describe('isSequenceFamilyEntry', () => {
  // The sequence family (sequence/mermaid/plantuml) all ship under the
  // zenuml-sequence-macro module and are rendered by forgeIndex itself.
  it.each([
    'zenuml-sequence-macro-lite',
    'zenuml-sequence-macro-full',
    'zenuml-sequence-macro',
    'gpt-diagram-macro-lite',
  ])('returns true for the sequence-family module key %s', (moduleKey) => {
    expect(isSequenceFamilyEntry(moduleKey, undefined)).toBe(true);
  });

  // Non-sequence macros delegate to a dedicated viewer/editor, so forgeIndex
  // must NOT claim them (otherwise it double-fires the orphan event).
  it.each([
    'zenuml-graph-macro-lite',
    'zenuml-embed-macro-lite',
    'zenuml-openapi-macro-lite',
    'zenuml-asyncapi-macro',
    'zenuml-asyncapi-embed-macro',
  ])('returns false for the delegated module key %s', (moduleKey) => {
    expect(isSequenceFamilyEntry(moduleKey, undefined)).toBe(false);
  });

  // Modal contexts opened from the sequence viewer (view-mode Edit / fullscreen)
  // carry no macro moduleKey; they identify the family via modal.diagramType.
  it('returns true for a sequence modal diagramType regardless of moduleKey', () => {
    expect(isSequenceFamilyEntry(undefined, 'sequence')).toBe(true);
    expect(isSequenceFamilyEntry('zenuml-sequence-macro-lite', 'sequence')).toBe(true);
  });

  it('returns true for a mermaid modal diagramType', () => {
    expect(isSequenceFamilyEntry(undefined, 'mermaid')).toBe(true);
  });

  it('returns false for an asyncapi modal diagramType', () => {
    expect(isSequenceFamilyEntry(undefined, 'asyncapi')).toBe(false);
  });

  it('returns false when both moduleKey and modal diagramType are absent', () => {
    expect(isSequenceFamilyEntry(undefined, undefined)).toBe(false);
    expect(isSequenceFamilyEntry('', undefined)).toBe(false);
  });
});

describe('delegated viewer orphan telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.context = {
      extension: {
        content: { id: 'page-1' },
        config: { customContentId: 'orphan-1' },
      },
    };
    h.loadCustomContentWithOrphanRecovery.mockResolvedValue({
      customContent: undefined,
      directFetchStatus: 'not_found',
    });
  });

  it('the graph viewer load reports its own kind once', async () => {
    await import('@/forge-graph-viewer');
    await vi.waitFor(() => expect(h.bootstrapForgeViewer).toHaveBeenCalled());
    const options = h.bootstrapForgeViewer.mock.calls.at(-1)?.[0] as any;
    await options.loadDiagram();

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      'orphan-1', 'customcontent_orphan_observed', 'warning',
      expect.objectContaining({ diagram_kind: 'graph' }),
    );
  });

  it('the embed viewer load reports its own kind once', async () => {
    const { loadDiagram } = await import('@/forge-embed-viewer');
    await loadDiagram();

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      'orphan-1', 'customcontent_orphan_observed', 'warning',
      expect.objectContaining({ diagram_kind: 'embed' }),
    );
  });
});
