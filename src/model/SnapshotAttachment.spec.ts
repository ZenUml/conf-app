import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramType } from './Diagram/Diagram';

const { mockGetAttachmentsV2, mockRequestConfluence } = vi.hoisted(() => {
  return {
    mockGetAttachmentsV2: vi.fn(),
    mockRequestConfluence: vi.fn(),
  };
});

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getAttachmentsV2: mockGetAttachmentsV2,
    },
  },
}));

vi.mock('@forge/bridge', () => ({
  requestConfluence: mockRequestConfluence,
}));

import {
  snapshotAttachmentName,
  buildSnapshot,
  uploadSnapshot,
  fetchSnapshot,
  snapshotToDiagram,
  type DiagramSnapshotV1,
} from './SnapshotAttachment';

describe('snapshotAttachmentName', () => {
  it('derives the name from the ccId', () => {
    expect(snapshotAttachmentName('12345')).toBe('zenuml-12345.json');
  });
  it('refuses invalid ccIds (undefined/null/empty writeback corruption)', () => {
    expect(snapshotAttachmentName('undefined')).toBeUndefined();
    expect(snapshotAttachmentName('')).toBeUndefined();
  });
});

describe('buildSnapshot', () => {
  it('builds a v1 snapshot for a mermaid diagram', () => {
    const snap = buildSnapshot(
      { diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD; A-->B', title: 'T' } as any,
      '12345', 7,
    );
    expect(snap).toMatchObject({
      version: 1, ccId: '12345', ccVersion: 7,
      diagramType: DiagramType.Mermaid, dsl: 'graph TD; A-->B',
    });
    expect(typeof snap!.snapshotAt).toBe('string');
  });

  it('builds a v1 snapshot for a sequence diagram', () => {
    const snap = buildSnapshot(
      { diagramType: DiagramType.Sequence, code: 'A.method()', title: 'Seq' } as any,
      '999',
    );
    expect(snap).toMatchObject({ version: 1, ccId: '999', diagramType: DiagramType.Sequence, dsl: 'A.method()' });
  });

  it('builds a v1 snapshot for a plantuml diagram', () => {
    const snap = buildSnapshot(
      { diagramType: DiagramType.PlantUml, plantUmlCode: '@startuml\nA->B\n@enduml' } as any,
      '111',
    );
    expect(snap).toMatchObject({ version: 1, ccId: '111', diagramType: DiagramType.PlantUml, dsl: '@startuml\nA->B\n@enduml' });
  });

  it('returns undefined for unsupported types (graph) and empty DSL', () => {
    expect(buildSnapshot({ diagramType: DiagramType.Graph, graphXml: '<x/>' } as any, '1')).toBeUndefined();
    expect(buildSnapshot({ diagramType: DiagramType.Sequence, code: '' } as any, '1')).toBeUndefined();
  });

  it('returns undefined for an invalid ccId even with a supported type and content', () => {
    expect(buildSnapshot({ diagramType: DiagramType.Sequence, code: 'A.method()' } as any, 'undefined')).toBeUndefined();
  });
});

describe('uploadSnapshot', () => {
  const snapshot: DiagramSnapshotV1 = {
    version: 1, ccId: '12345', dsl: 'A.method()', diagramType: DiagramType.Sequence,
    snapshotAt: '2026-07-18T00:00:00.000Z',
  };

  beforeEach(() => {
    mockRequestConfluence.mockReset();
  });

  it('PUTs a FormData body to the page attachment endpoint (upsert-by-filename)', async () => {
    mockRequestConfluence.mockResolvedValue({ ok: true, status: 200 });
    await uploadSnapshot('page-1', snapshot);
    expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
    const [url, init] = mockRequestConfluence.mock.calls[0];
    expect(url).toContain('/wiki/rest/api/content/page-1/child/attachment');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('throws on a non-ok HTTP response', async () => {
    mockRequestConfluence.mockResolvedValue({ ok: false, status: 403 });
    await expect(uploadSnapshot('page-1', snapshot)).rejects.toThrow(/403/);
  });

  it('throws (without a network call) for an invalid ccId', async () => {
    await expect(uploadSnapshot('page-1', { ...snapshot, ccId: 'undefined' })).rejects.toThrow();
    expect(mockRequestConfluence).not.toHaveBeenCalled();
  });
});

describe('fetchSnapshot', () => {
  beforeEach(() => {
    mockGetAttachmentsV2.mockReset();
    mockRequestConfluence.mockReset();
  });

  it('returns the parsed snapshot when the attachment exists and downloads cleanly', async () => {
    const snapshot: DiagramSnapshotV1 = {
      version: 1, ccId: '12345', dsl: 'A.method()', diagramType: DiagramType.Sequence,
      snapshotAt: '2026-07-18T00:00:00.000Z',
    };
    mockGetAttachmentsV2.mockResolvedValue([{ _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(snapshot)) });

    const result = await fetchSnapshot('page-1', '12345');
    expect(result).toEqual(snapshot);
    expect(mockGetAttachmentsV2).toHaveBeenCalledWith('page-1', { filename: 'zenuml-12345.json' });
  });

  it('returns undefined when no attachment is found', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    expect(await fetchSnapshot('page-1', '12345')).toBeUndefined();
    expect(mockRequestConfluence).not.toHaveBeenCalled();
  });

  it('returns undefined on a non-ok download response', async () => {
    mockGetAttachmentsV2.mockResolvedValue([{ _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockResolvedValue({ ok: false });
    expect(await fetchSnapshot('page-1', '12345')).toBeUndefined();
  });

  it('returns undefined for a malformed/non-v1 body instead of throwing', async () => {
    mockGetAttachmentsV2.mockResolvedValue([{ _links: { download: '/download/attachments/1/zenuml-12345.json' } }]);
    mockRequestConfluence.mockResolvedValue({ ok: true, text: () => Promise.resolve('not json') });
    expect(await fetchSnapshot('page-1', '12345')).toBeUndefined();
  });

  it('returns undefined for an invalid ccId (no lookup attempted)', async () => {
    expect(await fetchSnapshot('page-1', 'undefined')).toBeUndefined();
    expect(mockGetAttachmentsV2).not.toHaveBeenCalled();
  });

  it('returns undefined when getAttachmentsV2 itself throws', async () => {
    mockGetAttachmentsV2.mockRejectedValue(new Error('network error'));
    expect(await fetchSnapshot('page-1', '12345')).toBeUndefined();
  });
});

describe('snapshotToDiagram', () => {
  it('maps dsl to the per-type field and sets snapshot fallback markers', () => {
    const mermaid = snapshotToDiagram({
      version: 1,
      ccId: 'cc-m',
      diagramType: DiagramType.Mermaid,
      title: 'Flow',
      dsl: 'graph TD; A-->B',
      snapshotAt: '2026-07-01T00:00:00.000Z',
    });
    expect(mermaid).toMatchObject({
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'graph TD; A-->B',
      title: 'Flow',
      id: 'cc-m',
      snapshotFallback: true,
      snapshotAt: '2026-07-01T00:00:00.000Z',
    });

    const sequence = snapshotToDiagram({
      version: 1,
      ccId: 'cc-s',
      diagramType: DiagramType.Sequence,
      dsl: 'A.method',
      snapshotAt: '2026-07-02T00:00:00.000Z',
    });
    expect(sequence).toMatchObject({
      diagramType: DiagramType.Sequence,
      code: 'A.method',
      id: 'cc-s',
      snapshotFallback: true,
    });

    const plantuml = snapshotToDiagram({
      version: 1,
      ccId: 'cc-p',
      diagramType: DiagramType.PlantUml,
      dsl: '@startuml\nA->B\n@enduml',
      snapshotAt: '2026-07-03T00:00:00.000Z',
    });
    expect(plantuml).toMatchObject({
      diagramType: DiagramType.PlantUml,
      plantUmlCode: '@startuml\nA->B\n@enduml',
      id: 'cc-p',
      snapshotFallback: true,
    });
  });

  it('returns DiagramType.Unknown for unsupported diagramType strings', () => {
    const restored = snapshotToDiagram({
      version: 1,
      ccId: 'cc-x',
      diagramType: 'graph',
      dsl: '<mxGraphModel/>',
      snapshotAt: '2026-07-01T00:00:00.000Z',
    });
    expect(restored.diagramType).toBe(DiagramType.Unknown);
    expect(restored.snapshotFallback).toBe(true);
    expect(restored.id).toBe('cc-x');
    expect((restored as any).code).toBeUndefined();
    expect((restored as any).graphXml).toBeUndefined();
  });
});
