import { describe, it, expect, vi } from 'vitest';
import { unwrapMirrorBody, handleBodies, handleReport, mergeStats } from './service';
import { mixpanelImportServiceEvents } from '../service/mixpanelService';

vi.mock('../service/mixpanelService', () => ({
  mixpanelImportServiceEvents: vi.fn(async () => undefined),
}));

vi.mock('../metrics-cache/snapshot/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../metrics-cache/snapshot/common')>();
  return {
    ...actual,
    authenticateMetricsRequest: vi.fn(async () => ({
      cloudId: 'cloud-a',
      appId: 'd9e4002b-120b-426b-834b-402a4a5adce7', // Full
    })),
  };
});

/**
 * The D1 mirror stores `JSON.stringify(customContent.body)` — the whole
 * Confluence body OBJECT (`forge-custom-content.ts:101`), not the diagram
 * JSON. Handing that column straight to `POST /custom-content` produced a
 * double-wrapped Full custom content whose ADF looked perfect and whose macro
 * rendered nothing (observed on full-stg custom content 139755553,
 * 2026-08-11). All 7126 Lite rows in staging carry the wrapper — it is the
 * shape the writer always produces, not a legacy variant.
 */
describe('unwrapMirrorBody', () => {
  const diagram = JSON.stringify({ diagramType: 'sequence', code: 'A.method()' });

  it('returns the raw value out of the stored Confluence body object', () => {
    const stored = JSON.stringify({ raw: { representation: 'raw', value: diagram } });
    expect(unwrapMirrorBody(stored)).toBe(diagram);
  });

  it('ignores sibling expansion keys Confluence adds next to `raw`', () => {
    const stored = JSON.stringify({
      raw: { representation: 'raw', value: diagram },
      _expandable: { storage: '', view: '' },
    });
    expect(unwrapMirrorBody(stored)).toBe(diagram);
  });

  it('keeps a graph body byte-identical, mxfile XML and all', () => {
    const graph = JSON.stringify({
      diagramType: 'graph',
      graphXml: '<mxfile host="x"><diagram id="a">…</diagram></mxfile>',
    });
    const stored = JSON.stringify({ raw: { representation: 'raw', value: graph } });
    expect(unwrapMirrorBody(stored)).toBe(graph);
  });

  // Anything else is a shape this code has never seen. Return null so the id
  // lands in `missing` and the job counts it as skipped — creating content
  // from an unrecognised shape is how the double-wrap defect shipped.
  it('returns null when the stored column is not the expected shape', () => {
    expect(unwrapMirrorBody(diagram)).toBeNull();
    expect(unwrapMirrorBody('not json at all')).toBeNull();
    expect(unwrapMirrorBody(JSON.stringify({ raw: { representation: 'raw' } }))).toBeNull();
    expect(unwrapMirrorBody(JSON.stringify({ storage: { value: diagram } }))).toBeNull();
    expect(unwrapMirrorBody('')).toBeNull();
  });
});

/**
 * The mirror has no tenant column — `CustomContent` is keyed by
 * (contentId, appId) and `spaceId` counts up per site, so contentIds from a
 * different Confluence site resolve just as well. The claimed job is the only
 * tenant scope available.
 */
describe('handleBodies tenant scope', () => {
  const stored = JSON.stringify({
    raw: { representation: 'raw', value: JSON.stringify({ diagramType: 'sequence', code: 'A.b()' }) },
  });

  /** D1 double: `first()` answers the job lookup, `all()` the body select. */
  function dbWith(job: { id: string } | null) {
    return {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => job),
          all: vi.fn(async () => ({
            results: [{ contentId: '111', body: stored, title: 't', diagramType: 'sequence', versionNumber: 1 }],
          })),
        })),
      })),
    };
  }

  /** report path: `first()` reads the prior row, `run()` applies the update. */
  const reportDb = (statsJson: string | null = null, pageOffset = 0) => ({
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ statsJson, pageOffset })),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
    })),
  });

  const post = (body: unknown) =>
    new Request('https://x/conversion/bodies', { method: 'POST', body: JSON.stringify(body) });

  it('rejects a request with no jobId before touching the mirror', async () => {
    const db = dbWith({ id: 'job-1' });
    const res = await handleBodies(post({ contentIds: ['111'] }), { DB: db } as never, {} as never);
    expect(res.status).toBe(400);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("rejects a jobId that is not this tenant's claimed job", async () => {
    const res = await handleBodies(
      post({ jobId: 'someone-elses-job', contentIds: ['111'] }),
      { DB: dbWith(null) } as never,
      {} as never,
    );
    expect(res.status).toBe(403);
  });

  it('emits one deduplicated completion event carrying the job counts', async () => {
    vi.mocked(mixpanelImportServiceEvents).mockClear();
    const db = reportDb();
    const res = await handleReport(
      new Request('https://x/conversion/report', {
        method: 'POST',
        body: JSON.stringify({
          jobId: 'job-1',
          status: 'done',
          stats: { pagesTotal: 1, macrosConverted: 2, dryRun: false },
        }),
      }),
      { DB: db, MIXPANEL_TOKEN: 'tok' } as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    const [events, token] = vi.mocked(mixpanelImportServiceEvents).mock.calls[0];
    expect(token).toBe('tok');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'macro_convert_job_completed',
      distinctId: 'job-1',
      insertId: 'job-1:macro_convert_job_completed',
    });
    // Counts ride along so a completion answers "how much converted" alone.
    expect(events[0].properties).toMatchObject({
      convert_status: 'done',
      cloud_id: 'cloud-a',
      pagesTotal: 1,
      macrosConverted: 2,
    });
  });

  it('hands the delivery to waitUntil so the response cannot cancel it', async () => {
    vi.mocked(mixpanelImportServiceEvents).mockClear();
    const held: Promise<unknown>[] = [];
    await handleReport(
      new Request('https://x/conversion/report', {
        method: 'POST',
        body: JSON.stringify({ jobId: 'job-1', status: 'done' }),
      }),
      { DB: reportDb(), MIXPANEL_TOKEN: 'tok' } as never,
      {} as never,
      (p) => held.push(p),
    );
    // Without this the Worker returns and the in-flight Import fetch is
    // cancelled — observed on full-stg: claim event arrived, completion did not.
    expect(held).toHaveLength(1);
  });

  it('stays silent when no Mixpanel token is configured', async () => {
    vi.mocked(mixpanelImportServiceEvents).mockClear();
    const db = reportDb();
    await handleReport(
      new Request('https://x/conversion/report', {
        method: 'POST',
        body: JSON.stringify({ jobId: 'job-1', status: 'done' }),
      }),
      { DB: db } as never,
      {} as never,
    );
    expect(mixpanelImportServiceEvents).not.toHaveBeenCalled();
  });

  it('returns unwrapped bodies for a claimed job', async () => {
    const res = await handleBodies(
      post({ jobId: 'job-1', contentIds: ['111'] }),
      { DB: dbWith({ id: 'job-1' }) } as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { contents: Record<string, { body: string }> };
    expect(JSON.parse(payload.contents['111'].body)).toEqual({ diagramType: 'sequence', code: 'A.b()' });
  });
});

describe('mergeStats', () => {
  it('sums counts across batches so the final stats describe the whole job', () => {
    const prior = JSON.stringify({ pagesTotal: 25, macrosConverted: 40, dryRun: false });
    expect(mergeStats(prior, { pagesTotal: 7, macrosConverted: 9, dryRun: false })).toEqual({
      pagesTotal: 32,
      macrosConverted: 49,
      dryRun: false,
    });
  });

  it('keeps counts an earlier batch reported and this one omitted', () => {
    const prior = JSON.stringify({ pagesTotal: 2, macrosSkippedEmbed: 3 });
    expect(mergeStats(prior, { pagesTotal: 1 })).toEqual({ pagesTotal: 3, macrosSkippedEmbed: 3 });
  });

  it('treats an absent or unreadable prior as zero', () => {
    expect(mergeStats(null, { pagesTotal: 4 })).toEqual({ pagesTotal: 4 });
    expect(mergeStats('{not json', { pagesTotal: 4 })).toEqual({ pagesTotal: 4 });
  });
});

describe('handleReport requeue', () => {
  const reportRequest = (body: unknown) =>
    new Request('https://x/conversion/report', { method: 'POST', body: JSON.stringify(body) });

  it('puts a requeued job back in the queue and emits no completion', async () => {
    vi.mocked(mixpanelImportServiceEvents).mockClear();
    const bind = vi.fn(() => ({
      first: vi.fn(async () => ({ statsJson: '{"pagesTotal":25,"macrosConverted":40}', pageOffset: 0 })),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    }));
    const db = { prepare: vi.fn(() => ({ bind })) };
    const res = await handleReport(
      reportRequest({
        jobId: 'job-1',
        status: 'requeue',
        pagesProcessed: 25,
        stats: { pagesTotal: 25, macrosConverted: 40 },
      }),
      { DB: db, MIXPANEL_TOKEN: 'tok' } as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'queued' });
    // status='queued', claimedAt=null, cursor advanced by the pages processed.
    const args = bind.mock.calls[1];
    expect(args[1]).toBe('queued');
    expect(args[6]).toBeNull();
    expect(args[7]).toBe(25);
    // A mid-flight batch is not a completion.
    expect(mixpanelImportServiceEvents).not.toHaveBeenCalled();
  });

  it('rejects a status that is neither terminal nor requeue', async () => {
    const res = await handleReport(
      reportRequest({ jobId: 'job-1', status: 'running' }),
      { DB: { prepare: vi.fn() } } as never,
      {} as never,
    );
    expect(res.status).toBe(400);
  });
});
