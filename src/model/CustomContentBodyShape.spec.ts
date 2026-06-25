import { describe, it, expect, vi, beforeEach } from 'vitest';
import ApWrapper2 from './ApWrapper2';
import { forgeRequest } from '@/utils/requestUtil';

// EAG-99 — Pin the Confluence v2 custom-content `body.value` shape.
//
// WHY THIS TEST EXISTS (local-agent write contract):
// A local `create_diagram` agent tool wants to POST a custom-content body that
// the existing macro renders unchanged. The spike
// (conf-app-spike-local-agent/spike/SPIKE.md, 2026-06-25) proved that
// conf-app's `body.value` for a fresh Sequence create is `JSON.stringify` of a
// diagram object with a SPECIFIC key set AND insertion order:
//     [diagramType, code, mermaidCode, plantUmlCode, isNew, title]
// That order is an *incidental* artifact of the editor's `doc` literal
// (forgeIndex.ts) + the Vuex mutation order — NOT a declared contract. Any
// future reshuffle of those keys silently changes the serialized byte stream
// without breaking rendering, which would break any aligned local tool that
// shadows this exact shape for byte-identity. This test is the tripwire: it
// FAILS the moment the body shape drifts, so the drift is caught here instead
// of in a downstream consumer.
//
// This drives the REAL `ApWrapper2.createCustomContentV2` (the direct-create
// branch used by CustomContentStorageProvider.save) and asserts the exact
// POST payload `forgeRequest` receives — i.e. the real serializer, not a
// replica. The mocks below mirror the established ApWrapper2.spec.ts harness.

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  addonKey: 'test-addon',
}));

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn(),
  loadAllPaginatedData: vi.fn(),
}));

// forgeGlobal drives the `type` string via getCustomContentTypePrefix /
// getContentKey. isLite=false, isDiagramly=false, isAsyncApi=false → the
// ZenUML Full variant type `ac:com.zenuml.confluence-addon:zenuml-content-sequence`.
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: true,
    isLite: false,
    isDiagramly: false,
    isAsyncApi: false,
    forgeContext: null,
    zenumlRemoteBaseUrl: 'https://example.com',
  },
}));

vi.mock('@forge/bridge', () => ({
  requestConfluence: vi.fn(),
}));

// _getCurrentPageId() falls back to _page.getPageId() (forgeContext is null),
// so the create POST resolves pageId = '456' as its single parent.
vi.mock('@/model/page/AtlasPage', () => ({
  AtlasPage: vi.fn().mockImplementation(() => ({
    getPageId: vi.fn().mockResolvedValue('456'),
    countMacros: vi.fn().mockResolvedValue(1),
  })),
}));

describe('custom-content body.value shape — local-agent write contract (EAG-99)', () => {
  let wrapper: ApWrapper2;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = new ApWrapper2();
  });

  // The known Sequence fixture, built in the EXACT key insertion order the
  // editor save path produces (forgeIndex.ts `doc` literal + updateTitle):
  // diagramType, code, mermaidCode, plantUmlCode, isNew, then title last.
  function fixtureSequenceDiagram() {
    const diagram: any = {
      diagramType: 'sequence',
      code: 'title Order Service\nOrderController\nOrderController.post(payload) {\n  OrderService.create(payload)\n}',
      mermaidCode: '',
      plantUmlCode: '',
      isNew: true,
    };
    diagram.title = 'Order Service';
    return diagram;
  }

  // The single load-bearing assertion: the exact serialized body.value string.
  // If the diagram key set or insertion order drifts, this literal no longer
  // matches and the test fails — which is the whole point (catch the drift).
  const PINNED_BODY_VALUE =
    '{"diagramType":"sequence",' +
    '"code":"title Order Service\\nOrderController\\nOrderController.post(payload) {\\n  OrderService.create(payload)\\n}",' +
    '"mermaidCode":"",' +
    '"plantUmlCode":"",' +
    '"isNew":true,' +
    '"title":"Order Service"}';

  it('pins body.value, type, and body.representation for a fresh Sequence create', async () => {
    vi.mocked(forgeRequest).mockResolvedValueOnce({ id: 'cc-new', version: { number: 1 } });

    await wrapper.createCustomContentV2(fixtureSequenceDiagram());

    expect(forgeRequest).toHaveBeenCalledTimes(1);
    const [url, method, payload] = vi.mocked(forgeRequest).mock.calls[0] as [string, string, any];

    // Envelope: endpoint + method + parent.
    expect(url).toBe('/wiki/api/v2/custom-content');
    expect(method).toBe('POST');
    expect(payload.pageId).toBe('456');

    // type: the fully-qualified Full-variant custom-content type.
    expect(payload.type).toBe('ac:com.zenuml.confluence-addon:zenuml-content-sequence');

    // body.representation: hard-coded 'raw'.
    expect(payload.body.representation).toBe('raw');

    // body.value: EXACT string — pins key set AND insertion order.
    expect(payload.body.value).toBe(PINNED_BODY_VALUE);
  });

  it('pins the diagram key insertion order (the brittle bit JSON.stringify honors)', async () => {
    vi.mocked(forgeRequest).mockResolvedValueOnce({ id: 'cc-new', version: { number: 1 } });

    await wrapper.createCustomContentV2(fixtureSequenceDiagram());

    const payload = vi.mocked(forgeRequest).mock.calls[0][2] as any;
    // Object.keys reflects JSON insertion order; this is what drives the byte
    // stream and what a future editor refactor would silently reshuffle.
    expect(Object.keys(JSON.parse(payload.body.value))).toEqual([
      'diagramType',
      'code',
      'mermaidCode',
      'plantUmlCode',
      'isNew',
      'title',
    ]);
  });

  it('pins the Lite-variant type suffix (-lite) for the same body shape', async () => {
    // The type string is variant-dependent; lock the Lite suffix too so a
    // prefix/key change is caught. Body shape is variant-independent.
    const forgeGlobalMod = await import('@/model/globals/forgeGlobal');
    (forgeGlobalMod.default as any).isLite = true;
    try {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ id: 'cc-new', version: { number: 1 } });

      await wrapper.createCustomContentV2(fixtureSequenceDiagram());

      const payload = vi.mocked(forgeRequest).mock.calls[0][2] as any;
      expect(payload.type).toBe('ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence');
      expect(payload.body.value).toBe(PINNED_BODY_VALUE);
    } finally {
      (forgeGlobalMod.default as any).isLite = false;
    }
  });
});
