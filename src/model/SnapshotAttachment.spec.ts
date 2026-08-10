import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagramType } from './Diagram/Diagram';

const { mockGetAttachmentsV2, mockRequestConfluence, mockCallRemote, mockTrack } = vi.hoisted(() => {
  return {
    mockGetAttachmentsV2: vi.fn(),
    mockRequestConfluence: vi.fn(),
    mockCallRemote: vi.fn(),
    mockTrack: vi.fn(),
  };
});

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: mockTrack,
}));

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

vi.mock('@/utils/requestUtil', () => ({
  callRemote: mockCallRemote,
}));

import {
  snapshotAttachmentName,
  buildSnapshot,
  uploadSnapshot,
  fetchSnapshot,
  snapshotToDiagram,
  snapshotSkipReason,
  snapshotFailureDetail,
  maybeBackfillSnapshot,
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
    mockGetAttachmentsV2.mockReset();
    mockCallRemote.mockReset();
  });

  // Regression: BOTH prior implementations (PUT, then POST in PR #352) 404'd
  // through the client-side Forge `requestConfluence` proxy — the v1
  // `child/attachment` endpoint is unreachable that way regardless of verb.
  // Verified in production 2026-07-18 on page 2935849027, while the sibling
  // PNG attachment (Attachment.ts) succeeded on the same save via the
  // /forge-upload-attachment backend (app-authenticated). The v2 API has no
  // attachment-upload endpoint at all, so that backend is the only path —
  // mirror Attachment.ts's uploadAttachmentViaApp exactly.
  it('calls the backend to create a NEW attachment when none exists yet', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-new-1', versionNumber: 1 });

    await uploadSnapshot('page-1', snapshot);

    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.objectContaining({
      pageId: 'page-1',
      attachmentName: 'zenuml-12345.json',
      contentType: 'application/json',
      versionNumber: 1,
      dataBase64: expect.any(String),
    }));
    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST',
      expect.not.objectContaining({ attachmentId: expect.anything() }));
    expect(mockRequestConfluence).not.toHaveBeenCalled();
  });

  it('calls the backend with the existing attachmentId + bumped version on update', async () => {
    mockGetAttachmentsV2.mockResolvedValue([{ id: 'att-9', version: { number: 3 } }]);
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-9', versionNumber: 4 });

    await uploadSnapshot('page-1', snapshot);

    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.objectContaining({
      attachmentId: 'att-9',
      versionNumber: 4,
    }));
  });

  it('falls back to a create call (version 1, no id) when the existence lookup fails', async () => {
    mockGetAttachmentsV2.mockRejectedValue(new Error('lookup boom'));
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-new-2', versionNumber: 1 });

    await uploadSnapshot('page-1', snapshot);

    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.objectContaining({
      versionNumber: 1,
    }));
    expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST',
      expect.not.objectContaining({ attachmentId: expect.anything() }));
  });

  it('derives a deterministic hash from ccVersion — never Date.now()/random', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'att-1', versionNumber: 1 });

    await uploadSnapshot('page-1', { ...snapshot, ccVersion: 7 });
    await uploadSnapshot('page-1', { ...snapshot, ccVersion: 7 });

    const hashes = mockCallRemote.mock.calls.map(([, , payload]: any[]) => payload.hash);
    expect(hashes[0]).toBe('snapshot-v1-cc7');
    expect(hashes[1]).toBe(hashes[0]); // same ccVersion -> identical hash every time
  });

  it('throws on a non-ok backend result, attaching the HTTP status to the error', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockResolvedValue({ ok: false, status: 403, body: 'forbidden' });
    await expect(uploadSnapshot('page-1', snapshot)).rejects.toThrow(/403/);
    // The status is attached so callers can classify an expected skip without
    // re-parsing the message.
    await uploadSnapshot('page-1', snapshot).catch((e) => {
      expect((e as { status?: number }).status).toBe(403);
    });
  });

  it('throws when the callRemote transport itself rejects', async () => {
    mockGetAttachmentsV2.mockResolvedValue([]);
    mockCallRemote.mockRejectedValue(new Error('network down'));
    await expect(uploadSnapshot('page-1', snapshot)).rejects.toThrow(/network down/);
  });

  it('throws (without a network call) for an invalid ccId', async () => {
    await expect(uploadSnapshot('page-1', { ...snapshot, ccId: 'undefined' })).rejects.toThrow();
    expect(mockCallRemote).not.toHaveBeenCalled();
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

// #398: the stored `failure_reason` was `String(e.message).substring(0, 200)`,
// and the Confluence v1 error envelope is ~180 chars, so every recorded reason
// was cut mid-sentence inside the wrapper ("...api.PermissionException: Us").
// PR #395/#396 fixed exactly this on the attachment paths; the snapshot path
// never received the same treatment.
describe('snapshotFailureDetail', () => {
  const envelope = (status: number, cls: string, msg: string) =>
    new Error(
      `snapshot upload HTTP ${status}: ` +
        JSON.stringify({
          statusCode: status,
          data: { authorized: true, valid: true, errors: [], successful: true },
          message: `com.atlassian.confluence.api.service.exceptions.api.${cls}: ${msg}`,
        })
    );

  it('keeps the Confluence reason instead of the envelope', () => {
    const d = snapshotFailureDetail(
      envelope(403, 'PermissionException', 'User not permitted to update attachment')
    );
    expect(d.failure_reason).toContain('User not permitted to update attachment');
    expect(d.failure_reason).not.toContain('statusCode');
    expect(d.failure_reason.length).toBeLessThanOrEqual(200);
  });

  it('records the exception class for low-cardinality grouping', () => {
    expect(
      snapshotFailureDetail(envelope(404, 'NotFoundException', 'No content found with id')).confluence_error_class
    ).toBe('NotFoundException');
  });

  it('salvages the message from a TRUNCATED envelope', () => {
    const raw = 'snapshot upload HTTP 400: {"statusCode":400,"data":{},"message":"com.x.BadRequestException: Cannot add a new';
    const d = snapshotFailureDetail(new Error(raw));
    expect(d.failure_reason).toContain('Cannot add a new');
    expect(d.confluence_error_class).toBe('BadRequestException');
  });

  it('passes through a non-Confluence body unchanged (HTML page, transport error)', () => {
    const d = snapshotFailureDetail(new Error('network down'));
    expect(d.failure_reason).toBe('network down');
    expect(d.confluence_error_class).toBeUndefined();
  });

  it('handles a non-Error throwable', () => {
    expect(snapshotFailureDetail('boom').failure_reason).toBe('boom');
  });
});

// The emitters themselves had ZERO coverage, which is how the #398 truncation
// shipped in the first place — and how a first attempt at this very fix wired
// the new field into the skip event twice and the failure event not at all.
describe('maybeBackfillSnapshot — analytics emission', () => {
  const diagram = { diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD; A-->B' } as any;
  const envelope = (status: number, cls: string, msg: string) =>
    Object.assign(
      new Error(
        `snapshot upload HTTP ${status}: ` +
          JSON.stringify({ statusCode: status, data: {}, message: `com.atlassian.x.${cls}: ${msg}` })
      ),
      { status }
    );

  beforeEach(() => {
    mockTrack.mockReset();
    mockGetAttachmentsV2.mockReset();
    mockCallRemote.mockReset();
    mockGetAttachmentsV2.mockResolvedValue([]);
  });

  it('stamps confluence_error_class on snapshot_create_failed (genuine error)', async () => {
    mockCallRemote.mockRejectedValue(envelope(500, 'InternalServerException', 'boom'));

    await maybeBackfillSnapshot({
      hostPageId: 'page-1', ccId: '12345', diagram, isDisplayMode: true,
    });

    const call = mockTrack.mock.calls.find((c) => c[0] === 'snapshot_create_failed');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ confluence_error_class: 'InternalServerException' });
    expect(call![1].failure_reason).toContain('boom');
  });

  it('stamps confluence_error_class on snapshot_backfill_skipped (benign 403)', async () => {
    mockCallRemote.mockRejectedValue(envelope(403, 'PermissionException', 'not permitted'));

    await maybeBackfillSnapshot({
      hostPageId: 'page-1', ccId: '12345', diagram, isDisplayMode: true,
    });

    const call = mockTrack.mock.calls.find((c) => c[0] === 'snapshot_backfill_skipped');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      snapshot_skip_reason: 'no_write_permission',
      confluence_error_class: 'PermissionException',
    });
    expect(mockTrack.mock.calls.some((c) => c[0] === 'snapshot_create_failed')).toBe(false);
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

describe('snapshotSkipReason', () => {
  it('classifies 401/403 as no_write_permission (read-only viewer)', () => {
    expect(snapshotSkipReason(Object.assign(new Error('x'), { status: 403 }))).toBe('no_write_permission');
    expect(snapshotSkipReason(Object.assign(new Error('x'), { status: 401 }))).toBe('no_write_permission');
  });

  it('classifies 404 as page_not_published (unpublished draft)', () => {
    expect(snapshotSkipReason(Object.assign(new Error('x'), { status: 404 }))).toBe('page_not_published');
  });

  it('falls back to parsing the HTTP status out of the message when no .status is set', () => {
    expect(snapshotSkipReason(new Error('snapshot upload HTTP 403: forbidden'))).toBe('no_write_permission');
    expect(snapshotSkipReason(new Error('snapshot upload HTTP 404: NotFoundException'))).toBe('page_not_published');
  });

  it('returns undefined for genuine failures (5xx / transport / no status)', () => {
    expect(snapshotSkipReason(Object.assign(new Error('x'), { status: 500 }))).toBeUndefined();
    expect(snapshotSkipReason(new Error('snapshot upload transport error: Failed to fetch'))).toBeUndefined();
    expect(snapshotSkipReason(new Error('something else'))).toBeUndefined();
    expect(snapshotSkipReason(undefined)).toBeUndefined();
  });
});
