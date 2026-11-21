// A legacy Graph body (Connect-era `compressed: true`, LZUTF8-Base64 graphXml)
// must render on a content-SWR cache hit exactly as it does on a fresh fetch.
// The cache stores the RAW fetched doc; the cache-hit path used to mount it
// before decompressing, so ForgeGraphViewer's first render handed Base64 to
// GraphViewer, which threw "Not a diagram file" (viewer_load_failed,
// failure_stage=render_crash) on every revisit.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapForgeViewer } from '@/utils/viewerBootstrap';
import ForgeGraphViewer from '@/components/Viewer/ForgeGraphViewer.vue';
import { DataSource, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { compress } from '@/utils/compress';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { _resetForTesting } from '@/utils/renderCache/contentCacheStore';

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { initializeContext: vi.fn(() => Promise.resolve()), isDisplayMode: vi.fn(() => true) } },
}));
vi.mock('@/utils/paywall/mountPaywallGate', () => ({ tryFullscreenViewerPaywall: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { extension: { config: { customContentId: 'cc-legacy' } } } },
  getContext: vi.fn(() => Promise.resolve({ extension: { config: { customContentId: 'cc-legacy' } } })),
  isExportEntry: () => Promise.resolve(false),
}));
vi.mock('@/components/Viewer/GenericViewer.vue', () => ({
  default: { name: 'GenericViewer', template: '<div class="viewer-canvas"><slot /></div>' },
}));

const XML = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
const legacyDoc = {
  ...NULL_DIAGRAM,
  diagramType: DiagramType.Graph,
  source: DataSource.CustomContent,
  compressed: true,
  graphXml: compress(XML),
};
const renderCrashes = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');
const graphViewerInputs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  graphViewerInputs.length = 0;
  _resetForTesting();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  window.__macroLoadStart = 0;
  // DrawIO globals. parseXml keeps the text so the stub can see what was
  // handed over; like the real GraphViewer, it rejects anything that is not a
  // diagram document.
  // @ts-ignore
  window.mxUtils = { parseXml: (text: string) => ({ documentElement: { text } }) };
  // @ts-ignore
  window.GraphViewer = vi.fn(function (_container: unknown, node: { text: string }) {
    graphViewerInputs.push(node.text);
    if (!node.text.startsWith('<mxGraphModel')) throw { message: 'Not a diagram file' };
    return { diagrams: [], graph: {} };
  });
});

async function pageLoad(): Promise<void> {
  await bootstrapForgeViewer({
    macroKind: 'graph',
    content: ForgeGraphViewer,
    contentProps: { graphEditorMode: 'diagram' },
    loadDiagram: async () => JSON.parse(JSON.stringify(legacyDoc)),
    resolveContentId: () => 'cc-legacy',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('legacy compressed Graph body through the content-SWR cache', () => {
  it('renders plain XML on the first (fetch) load and on the revisit (cache hit)', async () => {
    await pageLoad();
    expect(graphViewerInputs).toEqual([XML]);

    vi.clearAllMocks();
    graphViewerInputs.length = 0;
    await pageLoad(); // the cache now holds the RAW compressed doc

    expect(graphViewerInputs.every((text) => text === XML)).toBe(true);
    expect(graphViewerInputs.length).toBeGreaterThan(0);
    expect(renderCrashes()).toHaveLength(0);
  });
});
