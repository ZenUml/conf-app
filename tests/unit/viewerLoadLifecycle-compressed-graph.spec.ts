import { describe, it, expect } from 'vitest';
import store from '@/model/store2';
import { runViewerLoadLifecycle } from '@/utils/viewerLoadLifecycle';
import { compress } from '@/utils/compress';
import { DiagramType } from '@/model/Diagram/Diagram';

// ZEN-1170 follow-up: legacy Connect-era graph/DrawIO macros whose custom-content
// body is `{ compressed: true, graphXml: <LZUTF8-Base64> }` rendered a blank
// canvas in the Forge viewer. loadDiagram's customContentId path (ApWrapper2
// JSON.parse) preserved `compressed: true` without decompressing, so the still-
// compressed string reached `store.state.diagram` and ForgeGraphViewer's
// `mxUtils.parseXml(<base64>)` threw (swallowed → blank). The content-property
// recovery path already decompressed; the customContentId path did not.
//
// The fix normalizes at the lifecycle's single publication boundary,
// so the store always holds plain <mxGraphModel> XML regardless of load path.
describe('viewerLoadLifecycle — legacy compressed graph normalization', () => {
  const SAMPLE_XML =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" value="IA/RDA"/></root></mxGraphModel>';

  async function publish(doc: any) {
    await runViewerLoadLifecycle({
      macroType: 'graph',
      getContext: async () => ({}),
      adapter: {
        resolve: async () => ({ status: 'loadable', target: 'graph' }),
        load: async () => doc,
      },
      mount: () => undefined,
    });
  }

  it('decompresses a compressed graph doc before it reaches the store', async () => {
    const doc = {
      diagramType: DiagramType.Graph,
      compressed: true,
      graphXml: compress(SAMPLE_XML),
    } as any;
    // sanity: the stored body is LZUTF8-Base64, not plain XML (the shape the
    // viewer detects via `!graphXml.startsWith('<mxGraphModel')`).
    expect(doc.graphXml.startsWith('<mxGraphModel')).toBe(false);

    await publish(doc);

    expect(store.state.diagram.graphXml?.startsWith('<mxGraphModel')).toBe(true);
    expect(store.state.diagram.graphXml).toBe(SAMPLE_XML);
    expect(store.state.diagram.compressed).toBe(false);
  });

  it('passes a plain-XML graph doc through unchanged', async () => {
    const doc = { diagramType: DiagramType.Graph, graphXml: SAMPLE_XML } as any;

    await publish(doc);

    expect(store.state.diagram.graphXml).toBe(SAMPLE_XML);
  });

  it('does not mutate the caller doc (afterLoad telemetry still sees compressed)', async () => {
    const compressed = compress(SAMPLE_XML);
    const doc = {
      diagramType: DiagramType.Graph,
      compressed: true,
      graphXml: compressed,
    } as any;

    await publish(doc);

    expect(doc.compressed).toBe(true);
    expect(doc.graphXml).toBe(compressed);
  });
});
