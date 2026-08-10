import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: vi.fn(() => true),
    },
  },
}));

vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: {
    name: 'GenericViewer',
    template: '<div class="generic-viewer"><slot /></div>',
  },
}));

const macroViewedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed');
const viewerLoadFailedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');

const VALID_XML = '<mxGraphModel><root></root></mxGraphModel>';

describe('ForgeGraphViewer render-failure telemetry', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: VALID_XML,
    };
    // @ts-ignore — DrawIO globals, loaded at runtime by loadDrawioViewer.ts.
    window.mxUtils = { parseXml: vi.fn(() => ({ documentElement: {} })) };
  });

  it('fires viewer_load_failed AND does not fire macro_viewed when GraphViewer construction throws — audit §4: neither used to fire', async () => {
    // @ts-ignore
    window.GraphViewer = vi.fn(() => {
      throw new Error('drawio init boom');
    });

    mount(ForgeGraphViewer, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });
    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'graph',
      failure_stage: 'render_crash',
      failure_reason: 'drawio init boom',
    });
    // The pre-fix bug: trackRenderTime sits inside the same try block a
    // crash escapes, so macro_viewed never fires on this path either.
    expect(macroViewedCalls()).toHaveLength(0);
  });

  it('fires viewer_load_failed when mxUtils.parseXml throws (malformed graphXml)', async () => {
    // @ts-ignore
    window.mxUtils = {
      parseXml: vi.fn(() => {
        throw new Error('bad xml');
      }),
    };
    // @ts-ignore
    window.GraphViewer = vi.fn(() => ({ diagrams: [] }));

    mount(ForgeGraphViewer, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });
    expect(viewerLoadFailedCalls()[0][1]).toMatchObject({
      macro_type: 'graph',
      failure_stage: 'render_crash',
      failure_reason: 'bad xml',
    });
  });

  it('fires macro_viewed and no failure on a clean render', async () => {
    // @ts-ignore
    window.GraphViewer = vi.fn(() => ({ diagrams: [{}], currentPage: 0 }));

    mount(ForgeGraphViewer, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(macroViewedCalls()).toHaveLength(1);
    });
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });
});
