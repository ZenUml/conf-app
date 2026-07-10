import { describe, it, expect, vi, beforeEach } from 'vitest';
import ApWrapper2 from './ApWrapper2';
import { trackEvent } from '@/utils/window';
import { forgeRequest } from '@/utils/requestUtil';
import { requestConfluence } from '@forge/bridge';

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  addonKey: 'test-addon',
}));

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn(),
  loadAllPaginatedData: vi.fn(),
}));

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: true,
    forgeContext: null,
    zenumlRemoteBaseUrl: 'https://example.com',
  },
}));

vi.mock('@forge/bridge', () => ({
  requestConfluence: vi.fn(),
}));

vi.mock('@/model/page/AtlasPage', () => ({
  AtlasPage: vi.fn().mockImplementation(() => ({
    getPageId: vi.fn().mockResolvedValue('456'),
    countMacros: vi.fn().mockResolvedValue(1),
  })),
}));

function buildContent(versionNumber = 5) {
  return {
    id: '123',
    type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
    status: 'current',
    pageId: '456',
    title: 'Test Diagram',
    body: { raw: { value: '{}' } },
    spaceId: '789',
    authorId: 'user1',
    createdAt: '2026-01-01',
    version: { number: versionNumber, createdAt: '2026-01-01', authorId: 'user1' },
    value: { code: 'A.method', diagramType: 'sequence' } as any,
  };
}

function buildDiagram() {
  return {
    code: 'A.method',
    diagramType: 'sequence',
    title: 'Test',
  } as any;
}

describe('ApWrapper2', () => {
  let wrapper: ApWrapper2;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = new ApWrapper2();
  });

  describe('getMacroContentTypes', () => {
    it('returns the fully-qualified custom-content types for both diagram macros', () => {
      const types = wrapper.getMacroContentTypes();
      expect(types).toHaveLength(2);
      expect(types[0].endsWith(':zenuml-content-sequence')).toBe(true);
      expect(types[1].endsWith(':zenuml-content-graph')).toBe(true);
    });
  });

  describe('updateCustomContentV2', () => {
    it('should succeed on first attempt and track update event', async () => {
      const content = buildContent(5);
      const diagram = buildDiagram();
      const mockResponse = { id: '123', version: { number: 6 } };

      vi.mocked(forgeRequest).mockResolvedValueOnce(mockResponse);

      const result = await wrapper.updateCustomContentV2(content, diagram);

      expect(result).toEqual(mockResponse);
      expect(forgeRequest).toHaveBeenCalledTimes(1);
      expect(forgeRequest).toHaveBeenCalledWith(
        '/wiki/api/v2/custom-content/123',
        'PUT',
        expect.objectContaining({ version: { number: 6 } })
      );
      expect(trackEvent).toHaveBeenCalledWith('"123"', 'update_custom_content', 'info');
    });

    it('strips stale compressed flag when updating a graph body with plain XML', async () => {
      const content = buildContent(5);
      const diagram = {
        id: '123',
        title: 'Graph',
        diagramType: 'graph',
        graphXml: '<mxfile><diagram /></mxfile>',
        compressed: true,
      } as any;
      vi.mocked(forgeRequest).mockResolvedValueOnce({ id: '123', version: { number: 6 } });

      await wrapper.updateCustomContentV2(content, diagram);

      const payload = vi.mocked(forgeRequest).mock.calls[0][2] as any;
      const serializedBody = JSON.parse(payload.body.value);
      expect(serializedBody.graphXml).toBe('<mxfile><diagram /></mxfile>');
      expect(serializedBody.compressed).toBeUndefined();
    });

    it('should retry on version conflict and succeed', async () => {
      const content = buildContent(5);
      const diagram = buildDiagram();
      const versionConflictError = new Error(
        'BAD_REQUEST: Version must be incremented when updating a ac:com.zenuml.confluence-addon:zenuml-content-sequence. Current Version: 5. Provided version: 5'
      );
      const freshContent = { version: { number: 5 } };
      const mockRetryResponse = { id: '123', version: { number: 6 } };

      vi.mocked(forgeRequest)
        .mockRejectedValueOnce(versionConflictError) // first PUT fails
        .mockResolvedValueOnce(freshContent)           // GET fresh version
        .mockResolvedValueOnce(mockRetryResponse);    // retry PUT succeeds

      const result = await wrapper.updateCustomContentV2(content, diagram);

      expect(result).toEqual(mockRetryResponse);
      expect(forgeRequest).toHaveBeenCalledTimes(3);

      // Verify retry PUT uses fresh version (5 + 1 = 6)
      expect(forgeRequest).toHaveBeenNthCalledWith(3,
        '/wiki/api/v2/custom-content/123',
        'PUT',
        expect.objectContaining({ version: { number: 6 } })
      );

      // Verify conflict retry event was tracked
      expect(trackEvent).toHaveBeenCalledWith(
        'save_conflict_retry', 'save_conflict_retry', 'info',
        expect.objectContaining({ content_id: '123' })
      );
    });

    it('should track structured error event on non-version-conflict failure', async () => {
      const content = buildContent(5);
      const diagram = buildDiagram();
      const httpError = Object.assign(new Error('Permission denied'), { status: 403 });

      vi.mocked(forgeRequest).mockRejectedValueOnce(httpError);

      await expect(wrapper.updateCustomContentV2(content, diagram)).rejects.toThrow('Permission denied');

      expect(trackEvent).toHaveBeenCalledWith(
        'update_custom_content_error', 'update_custom_content_error', 'error',
        expect.objectContaining({ error_message: expect.any(String), http_status: 403 })
      );
    });

    it('should track structured error event when retry also fails', async () => {
      const content = buildContent(5);
      const diagram = buildDiagram();
      const versionConflictError = new Error('Version must be incremented');
      const retryError = Object.assign(new Error('Server error'), { status: 500 });
      const freshContent = { version: { number: 7 } };

      vi.mocked(forgeRequest)
        .mockRejectedValueOnce(versionConflictError) // first PUT fails
        .mockResolvedValueOnce(freshContent)           // GET fresh version
        .mockRejectedValueOnce(retryError);            // retry PUT also fails

      await expect(wrapper.updateCustomContentV2(content, diagram)).rejects.toThrow('Server error');

      expect(trackEvent).toHaveBeenCalledWith(
        'update_custom_content_error', 'update_custom_content_error', 'error',
        expect.objectContaining({ error_message: 'Server error', http_status: 500 })
      );
    });

    it('should use unknown as http_status when error has no status property', async () => {
      const content = buildContent(5);
      const diagram = buildDiagram();
      const errorWithoutStatus = new Error('Something went wrong');

      vi.mocked(forgeRequest).mockRejectedValueOnce(errorWithoutStatus);

      await expect(wrapper.updateCustomContentV2(content, diagram)).rejects.toThrow();

      expect(trackEvent).toHaveBeenCalledWith(
        'update_custom_content_error', 'update_custom_content_error', 'error',
        expect.objectContaining({ http_status: 'unknown' })
      );
    });
  });

  describe('getCustomContentByIdV2', () => {
    // ZEN-1170 regression. Reproduced on lite-dev 2026-05-22 by creating a
    // page whose graph macro pointed at customContentId 999999999998 (which
    // does not exist). Direct evidence (private/zen-1170/repro-defect-2.mjs):
    //   GET /api/v2/custom-content/<id>?body-format=raw → HTTP 404
    //   Response body: {"errors":[{"status":404,"code":"NOT_FOUND", ...}]}
    //   Forge bridge parses .json() regardless of status, so the wrapper
    //   received the truthy { errors: [...] } object and crashed with
    //   "TypeError: Cannot read properties of undefined (reading 'raw')" at
    //   getCustomContentByIdV2 → iframe height collapsed to 0 px.
    it('returns the parsed diagram value on success', async () => {
      const apiResponse = {
        id: '321',
        body: { raw: { value: JSON.stringify({ code: 'A.method', diagramType: 'sequence' }) } },
      };
      vi.mocked(forgeRequest).mockResolvedValueOnce(apiResponse);

      const result = await wrapper.getCustomContentByIdV2('321');

      expect(result?.id).toBe('321');
      expect(result?.value?.code).toBe('A.method');
      expect(forgeRequest).toHaveBeenCalledWith(
        '/wiki/api/v2/custom-content/321?body-format=raw',
        'GET',
        undefined,
      );
    });

    it('returns undefined when the v2 API responds 404 with an errors array', async () => {
      // Exact body shape captured from lite-dev on 2026-05-22.
      vi.mocked(forgeRequest).mockResolvedValueOnce({
        errors: [{ status: 404, code: 'NOT_FOUND', title: 'Custom content with id not found: [999999999998]', detail: null }],
      });

      const result = await wrapper.getCustomContentByIdV2('999999999998');

      expect(result).toBeUndefined();
    });

    it('returns undefined when body.raw.value is missing (any non-success shape)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ id: '999' });

      const result = await wrapper.getCustomContentByIdV2('999');

      expect(result).toBeUndefined();
    });
  });

  // ZEN-1170 telemetry. When getCustomContentByIdV2 returns undefined the
  // viewer falls through to NULL_DIAGRAM (PR #115); we probe the page's
  // own custom-content children for a body whose embedded `id` matches the
  // orphan id, so we can report fleet-wide recoverability *before* shipping
  // any auto-repair logic. Read-only — no writes, no recovery yet.
  describe('probeOrphanRecovery', () => {
    const orphanId = '3916300417';
    const pageId = '5553291265';
    // Mirrors getCustomContentTypePrefix() under the spec's forgeGlobal mock
    // (isDiagramly=false, isLite=false). The probe queries BOTH types so a
    // Connect-era graph orphan (saved under zenuml-content-graph) is found
    // even when the current entry is the sequence path.
    const sequenceType = 'ac:com.zenuml.confluence-addon:zenuml-content-sequence';
    const graphType = 'ac:com.zenuml.confluence-addon:zenuml-content-graph';

    function childWith(id: string, bodyId: string) {
      return {
        id,
        body: { raw: { value: JSON.stringify({ id: bodyId, code: 'A.method', diagramType: 'sequence' }) } },
      };
    }

    const emptyPage = { results: [] };

    it('reports recoverable when a sequence-type child body.id matches the orphan id', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          results: [
            childWith('5553291584', 'unrelated-id'),
            childWith('5553291585', orphanId),
          ],
        })
        .mockResolvedValueOnce(emptyPage);

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe(true);
      expect(result.candidateCount).toBe(1);
      expect(result.pageChildrenTotal).toBe(2);
      expect(result.probeError).toBeUndefined();
      expect(forgeRequest).toHaveBeenCalledWith(
        `/wiki/api/v2/pages/${pageId}/custom-content?type=${encodeURIComponent(sequenceType)}&body-format=raw&limit=250`,
        'GET',
        undefined,
      );
      expect(forgeRequest).toHaveBeenCalledWith(
        `/wiki/api/v2/pages/${pageId}/custom-content?type=${encodeURIComponent(graphType)}&body-format=raw&limit=250`,
        'GET',
        undefined,
      );
    });

    // Customer ZEN-1170: gip-onshore page 5553291265 had orphan child CC
    // 5553291585 stored under the legacy `zenuml-content-graph` type. A
    // sequence-only probe would have reported recoverable=false on the
    // single case we already know is fixable. This test guards against
    // that regression.
    it('reports recoverable for a Connect-era graph-type orphan (customer scenario)', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(emptyPage)
        .mockResolvedValueOnce({
          results: [childWith('5553291585', orphanId)],
        });

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe(true);
      expect(result.candidateCount).toBe(1);
      expect(result.pageChildrenTotal).toBe(1);
    });

    it('reports not recoverable when no child body.id matches across either type', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          results: [
            childWith('a', 'x'),
            childWith('b', 'y'),
            childWith('c', 'z'),
          ],
        })
        .mockResolvedValueOnce(emptyPage);

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe(false);
      expect(result.candidateCount).toBe(0);
      expect(result.pageChildrenTotal).toBe(3);
    });

    it('reports not recoverable with zero children for an empty page', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(emptyPage)
        .mockResolvedValueOnce(emptyPage);

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe(false);
      expect(result.candidateCount).toBe(0);
      expect(result.pageChildrenTotal).toBe(0);
    });

    it('reports probe_failed when any listing API responds with an errors array', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(emptyPage)
        .mockResolvedValueOnce({
          errors: [{ status: 403, code: 'FORBIDDEN', title: 'Access denied', detail: null }],
        });

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe('probe_failed');
      expect(result.probeError).toContain('FORBIDDEN');
    });

    it('reports probe_failed when forgeRequest throws', async () => {
      vi.mocked(forgeRequest).mockRejectedValueOnce(new Error('network down'));

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe('probe_failed');
      expect(result.probeError).toContain('network down');
    });

    it('counts but does not match children with malformed body JSON', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          results: [
            { id: 'a', body: { raw: { value: 'not-json' } } },
            childWith('b', orphanId),
          ],
        })
        .mockResolvedValueOnce(emptyPage);

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.recoverable).toBe(true);
      expect(result.candidateCount).toBe(1);
      expect(result.pageChildrenTotal).toBe(2);
    });

    it('flags truncated when results hit the limit and a next link exists', async () => {
      const results = Array.from({ length: 250 }, (_, i) => childWith(`c${i}`, 'noop'));
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          results,
          _links: { next: '/wiki/api/v2/pages/.../custom-content?cursor=...' },
        })
        .mockResolvedValueOnce(emptyPage);

      const result = await wrapper.probeOrphanRecovery(pageId, orphanId);

      expect(result.truncated).toBe(true);
      expect(result.pageChildrenTotal).toBe(250);
    });
  });

  // ZEN-1170 Defect 2b. The viewer's referenced customContentId is dead
  // (404, deleted, restricted) but a sibling custom content on the same page
  // has `body.id` matching the orphan id — the surviving copy from a
  // historical cross-page-copy → dedupe flow. loadCustomContentWithOrphanRecovery
  // composes direct fetch + probe + recovery-fetch into one call.
  describe('loadCustomContentWithOrphanRecovery', () => {
    const orphanId = '3916300417';
    const recoveredId = '5553291585';
    const pageId = '5553291265';

    function childWith(id: string, bodyId: string) {
      return {
        id,
        body: { raw: { value: JSON.stringify({ id: bodyId, code: 'A.method', diagramType: 'sequence' }) } },
      };
    }

    function happyCustomContent(id: string) {
      return {
        id,
        pageId,
        body: { raw: { value: JSON.stringify({ code: 'B.method', diagramType: 'sequence' }) } },
      };
    }

    it('returns the requested CC directly on happy path (no recovery)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce(happyCustomContent('123'));

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, '123');

      expect(result.customContent?.id).toBe('123');
      expect(result.recoveredFromOrphanId).toBeUndefined();
      expect(result.probeResult).toBeUndefined();
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('recovers a single page-child whose body.id matches the orphan id', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] })
        .mockResolvedValueOnce({ results: [childWith(recoveredId, orphanId)] })
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce(happyCustomContent(recoveredId));

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent?.id).toBe(recoveredId);
      expect(result.recoveredFromOrphanId).toBe(orphanId);
      expect(result.probeResult?.recoverable).toBe(true);
      expect(result.probeResult?.candidateCount).toBe(1);
    });

    it('does not recover when probe finds multiple matching candidates (ambiguous)', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] })
        .mockResolvedValueOnce({ results: [childWith('aaa', orphanId), childWith('bbb', orphanId)] })
        .mockResolvedValueOnce({ results: [] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.recoveredFromOrphanId).toBeUndefined();
      expect(result.probeResult?.candidateCount).toBe(2);
    });

    it('returns undefined when probe finds no candidates', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] })
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({ results: [] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.recoveredFromOrphanId).toBeUndefined();
      expect(result.probeResult?.recoverable).toBe(false);
    });

    it('returns undefined and surfaces the probe error when the listing API fails', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] })
        .mockResolvedValueOnce({ errors: [{ status: 403, code: 'FORBIDDEN' }] })
        .mockResolvedValueOnce({ results: [] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.recoveredFromOrphanId).toBeUndefined();
      expect(result.probeResult?.recoverable).toBe('probe_failed');
    });

    it('returns undefined when the recovered-CC fetch itself fails (race/permission edge)', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] })
        .mockResolvedValueOnce({ results: [childWith(recoveredId, orphanId)] })
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.recoveredFromOrphanId).toBeUndefined();
      expect(result.probeResult?.candidateCount).toBe(1);
    });

    it('returns undefined without probing when pageId is undefined', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(undefined, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.probeResult).toBeUndefined();
      expect(result.directFetchStatus).toBe('not_found');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    // ZEN-1170 Defect 2b safety: recovery must NOT trigger on transient
    // failures (403 / 5xx / malformed). Probing a sibling and (in config
    // surface) rewriting the macro XML on top of a brief outage would
    // cause incorrect repairs.
    it('does not probe or recover on a 403 direct-fetch (transient permission failure)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 403, code: 'FORBIDDEN' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.recoveredFromOrphanId).toBeUndefined();
      expect(result.probeResult).toBeUndefined();
      expect(result.directFetchStatus).toBe('other_error');
      // No probe, no recovered fetch — only the direct fetch.
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('does not probe or recover on a 500 direct-fetch (transient server error)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 500, code: 'INTERNAL_SERVER_ERROR' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('does not probe or recover when the direct fetch throws (network error)', async () => {
      vi.mocked(forgeRequest).mockRejectedValueOnce(new Error('network down'));

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('does not probe or recover when the direct fetch returns a malformed body', async () => {
      // Truthy response but no errors AND no body.raw.value → unexpected shape.
      vi.mocked(forgeRequest).mockResolvedValueOnce({ id: 'whatever', someUnexpected: 'shape' });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.customContent).toBeUndefined();
      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    // Strict 404 detection — guard against mismatched / mixed error payloads
    // looking like a 404 when they aren't.
    it('treats {status: 403, code: NOT_FOUND} as other_error (status/code mismatch)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 403, code: 'NOT_FOUND' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('treats {status: 404, code: FORBIDDEN} as other_error (status/code mismatch)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 404, code: 'FORBIDDEN' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('treats {status: 429, code: RATE_LIMITED} as other_error', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 429, code: 'RATE_LIMITED' }] });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    it('treats a mixed errors array (one strict 404 + one transient) as other_error', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({
        errors: [
          { status: 404, code: 'NOT_FOUND' },
          { status: 500, code: 'INTERNAL_SERVER_ERROR' },
        ],
      });

      const result = await wrapper.loadCustomContentWithOrphanRecovery(pageId, orphanId);

      expect(result.directFetchStatus).toBe('other_error');
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });
  });

  // ZEN-1170 Defect 1 sibling: cross-page-paste recovery via uuid → CC title.
  // Connect-era macros stored only {uuid, updatedAt} in macro params. When
  // copy-pasted, the macro params travel but content properties do not — so
  // both the customContentId path and the Defect 1 content-property fallback
  // miss. The diagram however survives as a CustomContent on the SOURCE
  // page, titled with the uuid. This fallback finds it.
  //
  // Real-world verification 2026-05-25 against a customer tenant: 27 distinct
  // CC records shared the same uuid title (a Connect-era save flow created a
  // new record each save instead of versioning); limit=250 fetches them all
  // in one page and version.createdAt sort picks the most recent.
  describe('findLegacyCustomContentByUuid', () => {
    const uuid = '6a0a1be1-8d41-47cc-a710-934e9d19480b';
    const sequenceType = 'ac:com.zenuml.confluence-addon:zenuml-content-sequence';
    const graphType = 'ac:com.zenuml.confluence-addon:zenuml-content-graph';

    function cqlResults(ids: string[]) {
      return { results: ids.map(id => ({ content: { id } })) };
    }

    function ccBody(opts: { id: string; pageId: string; title?: string; diagramType?: string; createdAt?: string; extra?: any }) {
      const body = {
        diagramType: opts.diagramType ?? 'graph',
        graphXml: '<mxGraphModel/>',
        ...(opts.extra || {}),
      };
      return {
        id: opts.id,
        type: graphType,
        title: opts.title ?? uuid,
        pageId: opts.pageId,
        body: { raw: { value: JSON.stringify(body) } },
        version: { number: 2, createdAt: opts.createdAt ?? '2024-09-10T00:00:00Z' },
      };
    }

    it('returns undefined for an empty uuid (no API calls)', async () => {
      const result = await wrapper.findLegacyCustomContentByUuid('');
      expect(result).toBeUndefined();
      expect(forgeRequest).not.toHaveBeenCalled();
    });

    // CQL is used instead of /api/v2/custom-content?title=... because the V2
    // title= filter is silently ignored — verified on whimet4 2026-05-27
    // (1000+ CCs, matching record buried beyond limit=250). CQL with exact
    // `title = "<uuid>"` matching is reliable and permission-scoped.
    it('runs a CQL exact-title search across both legacy CC types', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ results: [] });

      await wrapper.findLegacyCustomContentByUuid(uuid);

      const expectedCql = `(type = "${sequenceType}" OR type = "${graphType}") AND title = "${uuid}"`;
      expect(forgeRequest).toHaveBeenCalledWith(
        `/wiki/rest/api/search?cql=${encodeURIComponent(expectedCql)}&limit=250`,
      );
    });

    it('flags isCopy=true when the resolved content lives on a different page (customer scenario)', async () => {
      // Customer macro on page 456 (spec's default getPageId mock) is a paste
      // of a Connect-era macro whose data lives on page 999. Viewer should
      // render the recovered diagram with the cross-page marker.
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['3681484960']))
        .mockResolvedValueOnce(ccBody({ id: '3681484960', pageId: '999' }));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result?.id).toBe('3681484960');
      expect((result?.value as any)?.isCopy).toBe(true);
      expect((result?.value as any)?.copyReason).toBe('cross-page');
      expect((result?.value as any)?.diagramType).toBe('graph');
      expect((result?.value as any)?.source).toBe('custom-content');
      expect((result?.value as any)?.id).toBe('3681484960');
    });

    it('does not flag isCopy when the resolved content lives on the current page', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['cc1']))
        .mockResolvedValueOnce(ccBody({ id: 'cc1', pageId: '456' }));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect((result?.value as any)?.isCopy).toBe(false);
      expect((result?.value as any)?.copyReason).toBeUndefined();
    });

    it('picks the most recently versioned match when several exist (customer 27-CC case)', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['older', 'newest', 'middle']))
        .mockResolvedValueOnce(ccBody({ id: 'older', pageId: '456', createdAt: '2021-08-01T00:00:00Z' }))
        .mockResolvedValueOnce(ccBody({ id: 'newest', pageId: '456', createdAt: '2024-09-10T00:00:00Z' }))
        .mockResolvedValueOnce(ccBody({ id: 'middle', pageId: '456', createdAt: '2021-12-13T00:00:00Z' }));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result?.id).toBe('newest');
    });

    it('resolves a sequence-typed match too (CQL covers both legacy types)', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['seq1']))
        .mockResolvedValueOnce(ccBody({ id: 'seq1', pageId: '456', diagramType: 'sequence' }));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result?.id).toBe('seq1');
      expect((result?.value as any)?.diagramType).toBe('sequence');
    });

    it('returns undefined when CQL yields zero matches', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ results: [] });

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result).toBeUndefined();
      // Single API call — no per-id fetches when CQL is empty.
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    // Defensive: server should return only exact-title matches, but if a
    // race / cache anomaly returns a wrong-title body, skip it.
    it('defensively skips fetched bodies whose title does not match the uuid', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['wrong']))
        .mockResolvedValueOnce(ccBody({ id: 'wrong', pageId: '456', title: 'something-else' }));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result).toBeUndefined();
    });

    it('ignores fetched bodies that fail to parse or lack diagramType', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['malformed', 'no-type']))
        .mockResolvedValueOnce({ id: 'malformed', title: uuid, pageId: '456', body: { raw: { value: 'not-json' } }, version: { createdAt: '2024-01-01' } })
        .mockResolvedValueOnce({ id: 'no-type', title: uuid, pageId: '456', body: { raw: { value: JSON.stringify({ noDiagramType: true }) } }, version: { createdAt: '2024-01-01' } });

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result).toBeUndefined();
    });

    // One bad per-id fetch (403, network blip, etc.) must not poison the
    // whole recovery — the helper should still return a good neighbour.
    it('tolerates a per-id fetch failure when other candidates remain valid', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(cqlResults(['busted', 'good']))
        .mockRejectedValueOnce(new Error('403 forbidden'))
        .mockResolvedValueOnce(ccBody({ id: 'good', pageId: '456' }));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result?.id).toBe('good');
    });

    it('returns undefined and tracks an error event when the CQL search itself throws', async () => {
      vi.mocked(forgeRequest).mockRejectedValue(new Error('network down'));

      const result = await wrapper.findLegacyCustomContentByUuid(uuid);

      expect(result).toBeUndefined();
      expect(trackEvent).toHaveBeenCalledWith(
        expect.stringContaining('network down'),
        'find_legacy_custom_content_by_uuid',
        'error',
      );
    });
  });

  // ZEN-1170 Defect 2b: when a diagram was loaded via orphan-sibling
  // recovery (diagram.recoveredFromOrphanId set), saveCustomContentV2 must
  // update the recovered CC in-place rather than creating a third record,
  // AND preserve body.id = orphanId so future probes still find this CC
  // even if the macro-config repair via view.submit doesn't land.
  describe('saveCustomContentV2 — orphan recovery save path', () => {
    const orphanId = '3916300417';
    const recoveredId = '5553291585';

    it('updates the recovered CC in-place when recoveredFromOrphanId is set and macro count is 0', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          id: recoveredId,
          pageId: '456',
          type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
          status: 'current',
          version: { number: 2 },
          body: { raw: { value: JSON.stringify({ code: 'old-code', diagramType: 'sequence', id: orphanId }) } },
        })
        .mockResolvedValueOnce({ id: recoveredId, version: { number: 3 } });

      const valueWithRecovery: any = {
        id: recoveredId,
        recoveredFromOrphanId: orphanId,
        code: 'new-code',
        diagramType: 'sequence',
        source: 'custom-content',
      };

      const result = await wrapper.saveCustomContentV2(recoveredId, valueWithRecovery);

      expect(result?.id).toBe(recoveredId);
      const updateCall = vi.mocked(forgeRequest).mock.calls[1];
      expect(updateCall[0]).toBe(`/wiki/api/v2/custom-content/${recoveredId}`);
      expect(updateCall[1]).toBe('PUT');
      // The serialized body must carry id = orphanId (preserved), not recoveredId.
      // This is the marker future probe-based recovery uses to find this CC
      // if the macro-config repair via view.submit hasn't landed.
      const putPayload = updateCall[2] as any;
      const serializedBody = JSON.parse(putPayload.body.value);
      expect(serializedBody.id).toBe(orphanId);
      expect(serializedBody.code).toBe('new-code');
    });

    it('falls through to create when recoveredFromOrphanId is set but existing fetch returns not_found', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({ errors: [{ status: 404, code: 'NOT_FOUND' }] })
        .mockResolvedValueOnce({ id: 'new-id', version: { number: 1 } });

      const valueWithRecovery: any = {
        id: recoveredId,
        recoveredFromOrphanId: orphanId,
        code: 'edits',
        diagramType: 'sequence',
        source: 'custom-content',
      };

      const result = await wrapper.saveCustomContentV2(recoveredId, valueWithRecovery);

      expect(result?.id).toBe('new-id');
      const createCall = vi.mocked(forgeRequest).mock.calls[1];
      expect(createCall[0]).toBe('/wiki/api/v2/custom-content');
      expect(createCall[1]).toBe('POST');
      // Even on create, the body preserves id = orphanId so the newly-created
      // CC is recoverable via probe on future visits.
      const serializedBody = JSON.parse((createCall[2] as any).body.value);
      expect(serializedBody.id).toBe(orphanId);
    });

    it('throws when existence check returns other_error (transient failure must not silently create)', async () => {
      vi.mocked(forgeRequest).mockResolvedValueOnce({ errors: [{ status: 500, code: 'INTERNAL_SERVER_ERROR' }] });

      const value: any = {
        id: recoveredId,
        code: 'edits',
        diagramType: 'sequence',
        source: 'custom-content',
      };

      await expect(wrapper.saveCustomContentV2(recoveredId, value)).rejects.toThrow(/existence check/);
      expect(vi.mocked(forgeRequest).mock.calls.length).toBe(1);
    });

    // ZEN-1170 Defect 2b regression: the UI/control-plane flags
    // (recoveredFromOrphan, recoveredFromOrphanId) must NOT be persisted in
    // the CC body. Otherwise every future direct fetch would parse them
    // out and treat the (now-repaired) CC as still-recovered indefinitely
    // — the viewer would keep disabling Edit, the save path would keep
    // overriding body.id to the old orphan id, and the macro would never
    // exit the "recovered" UX state.
    it('strips recoveredFromOrphan and recoveredFromOrphanId from the persisted body', async () => {
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          id: recoveredId,
          pageId: '456',
          type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
          status: 'current',
          version: { number: 2 },
          body: { raw: { value: JSON.stringify({ code: 'old', diagramType: 'sequence', id: orphanId }) } },
        })
        .mockResolvedValueOnce({ id: recoveredId, version: { number: 3 } });

      const valueWithFlags: any = {
        id: recoveredId,
        recoveredFromOrphan: true,
        recoveredFromOrphanId: orphanId,
        code: 'new',
        diagramType: 'sequence',
        source: 'custom-content',
      };

      await wrapper.saveCustomContentV2(recoveredId, valueWithFlags);

      const updateCall = vi.mocked(forgeRequest).mock.calls[1];
      const serializedBody = JSON.parse((updateCall[2] as any).body.value);
      // body.id is preserved as the orphan id (the recovery marker)
      expect(serializedBody.id).toBe(orphanId);
      // But the control-plane flags themselves are stripped — they're a
      // load-time UI state, not part of the diagram's persisted identity.
      expect(serializedBody.recoveredFromOrphan).toBeUndefined();
      expect(serializedBody.recoveredFromOrphanId).toBeUndefined();
    });
  });

  // ZEN-#169 / Fix 1a — the create-vs-update guard in saveCustomContentV2.
  //
  // `count` here is AtlasPage.countMacros(), which reads the PUBLISHED page
  // body (the Forge iframe can't see the editor's draft). The guard decides
  // whether to UPDATE the existing custom content in place or CREATE (fork) a
  // new one. The bug: it forked whenever count !== 1, so a macro whose
  // customContentId binding lives only in an unpublished draft (count === 0,
  // because the published body has no macro referencing it) forked a fresh cc
  // on every save — orphaning the edit and, in the non-submittable in-viewer
  // modal, throwing on the config writeback.
  //
  // Fix 1a: treat count <= 1 as "safe to update in place" (0 = draft-only
  // binding / orphan, 1 = the normal single macro). count > 1 still forks —
  // that is a genuine same-page duplicate (copy). These tests lock that
  // truth table so the fork can never silently come back for count === 0.
  describe('saveCustomContentV2 — draft-only binding update guard (ZEN-#169 / 1a)', () => {
    const ccId = '5690394053';

    // GET existence-check response: a healthy cc that lives on the current page
    // (pageId 456 — the AtlasPage mock's getPageId, so samePage === true).
    function mockExistence() {
      return {
        id: ccId,
        pageId: '456',
        type: 'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
        status: 'current',
        version: { number: 2 },
        body: { raw: { value: JSON.stringify({ code: 'old', diagramType: 'sequence' }) } },
      };
    }

    function diagramToSave() {
      return { id: ccId, code: 'edited', diagramType: 'sequence', source: 'custom-content' } as any;
    }

    // The lock: count === 0 means the binding is only in the draft, NOT a copy.
    // Pre-1a this forked (the incident). It MUST update the existing cc in place.
    it('count === 0 (draft-only binding) → UPDATES in place, does not fork', async () => {
      (wrapper as any)._page.countMacros = vi.fn().mockResolvedValue(0);
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(mockExistence())                       // existence GET
        .mockResolvedValueOnce({ id: ccId, version: { number: 3 } }); // update PUT

      const result = await wrapper.saveCustomContentV2(ccId, diagramToSave());

      const writeCall = vi.mocked(forgeRequest).mock.calls[1];
      expect(writeCall[0]).toBe(`/wiki/api/v2/custom-content/${ccId}`); // same id → in-place
      expect(writeCall[1]).toBe('PUT');                                 // UPDATE, not POST/create
      expect(result?.id).toBe(ccId);                                    // id unchanged → no fork
    });

    // The normal healthy case — exactly one macro references the cc.
    it('count === 1 (single macro) → UPDATES in place', async () => {
      (wrapper as any)._page.countMacros = vi.fn().mockResolvedValue(1);
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(mockExistence())
        .mockResolvedValueOnce({ id: ccId, version: { number: 3 } });

      await wrapper.saveCustomContentV2(ccId, diagramToSave());

      const writeCall = vi.mocked(forgeRequest).mock.calls[1];
      expect(writeCall[0]).toBe(`/wiki/api/v2/custom-content/${ccId}`);
      expect(writeCall[1]).toBe('PUT');
    });

    it('strips stale compressed flag when saving edited graph XML in place', async () => {
      (wrapper as any)._page.countMacros = vi.fn().mockResolvedValue(1);
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce({
          ...mockExistence(),
          type: 'ac:com.zenuml.confluence-addon:zenuml-content-graph',
          body: { raw: { value: JSON.stringify({ graphXml: 'legacy-compressed', diagramType: 'graph', compressed: true }) } },
        })
        .mockResolvedValueOnce({ id: ccId, version: { number: 3 } });

      await wrapper.saveCustomContentV2(ccId, {
        id: ccId,
        title: 'Edited graph',
        diagramType: 'graph',
        source: 'custom-content',
        graphXml: '<mxfile><diagram /></mxfile>',
        compressed: true,
      } as any);

      const writeCall = vi.mocked(forgeRequest).mock.calls[1];
      const serializedBody = JSON.parse((writeCall[2] as any).body.value);
      expect(serializedBody.graphXml).toBe('<mxfile><diagram /></mxfile>');
      expect(serializedBody.compressed).toBeUndefined();
    });

    // The copy case MUST still fork — two macros on the page share the cc, so a
    // save needs its own record. 1a must not regress this.
    it('count > 1 (same-page duplicate / copy) → CREATES a new cc (forks)', async () => {
      (wrapper as any)._page.countMacros = vi.fn().mockResolvedValue(2);
      vi.mocked(forgeRequest)
        .mockResolvedValueOnce(mockExistence())                          // existence GET
        .mockResolvedValueOnce({ id: 'new-forked-id', version: { number: 1 } }); // create POST

      const result = await wrapper.saveCustomContentV2(ccId, diagramToSave());

      const writeCall = vi.mocked(forgeRequest).mock.calls[1];
      expect(writeCall[0]).toBe('/wiki/api/v2/custom-content'); // collection endpoint → create
      expect(writeCall[1]).toBe('POST');
      expect(result?.id).toBe('new-forked-id');                 // forked to a new id
    });
  });

  describe('isVersionConflict (via updateCustomContentV2 behavior)', () => {
    it('should detect version conflict from error message', async () => {
      const content = buildContent(3);
      const diagram = buildDiagram();
      const conflictError = new Error('Version must be incremented when updating content');
      const freshContent = { version: { number: 3 } };
      const retryResponse = { id: '123', version: { number: 4 } };

      vi.mocked(forgeRequest)
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce(freshContent)
        .mockResolvedValueOnce(retryResponse);

      await wrapper.updateCustomContentV2(content, diagram);

      // Should have made 3 calls (initial PUT, GET fresh, retry PUT)
      expect(forgeRequest).toHaveBeenCalledTimes(3);
      // The GET for fresh version
      expect(forgeRequest).toHaveBeenNthCalledWith(2,
        '/wiki/api/v2/custom-content/123?body-format=raw',
        'GET',
        undefined
      );
    });
  });

  // ZEN-1170 Defect 1
  describe('getContentPropertyV2', () => {
    const reqMock = vi.mocked(requestConfluence);

    function mockResponse(init: { status: number; ok: boolean; json?: () => Promise<unknown> }) {
      return Promise.resolve({
        status: init.status,
        ok: init.ok,
        json: init.json ?? (() => Promise.resolve({})),
      } as any);
    }

    beforeEach(() => {
      reqMock.mockReset();
      wrapper.currentPageId = 'page-123';
    });

    it('returns ok with the object value on 200 (V2 results array, first entry)', async () => {
      const value = { code: 'A.method', diagramType: 'sequence' };
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [{ value, version: { number: 7 } }] }),
      }));
      const result = await wrapper.getContentPropertyV2('zenuml-sequence-macro-abc-body');
      expect(result.status).toBe('ok');
      expect(result.status === 'ok' && result.property.value).toEqual(value);
      expect(result.status === 'ok' && result.property.version?.number).toBe(7);
    });

    it('returns ok with the string value on 200 (very-old format, wrapped in V2 results)', async () => {
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [{ value: 'A.method', version: { number: 1 } }] }),
      }));
      const result = await wrapper.getContentPropertyV2('zenuml-sequence-macro-abc-body');
      expect(result.status).toBe('ok');
      expect(result.status === 'ok' && result.property.value).toBe('A.method');
    });

    it('returns not_found when V2 returns 200 with empty results (key not present)', async () => {
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [] }),
      }));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('not_found');
    });

    // ZEN-1170 Defect 1 regression: V2 404 means PAGE not reachable, NOT
    // "key absent on this page". Editor callers must fail closed on this so
    // a transient page-lookup failure can't be misread as "safe to save
    // fresh" and destroy legacy data on a different (real) page.
    it('returns page_not_found on 404 (page itself not reachable) — distinct from not_found', async () => {
      reqMock.mockImplementation(() => mockResponse({ status: 404, ok: false }));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('page_not_found');
    });

    it('returns forbidden on 403 (must NOT be treated as absence)', async () => {
      reqMock.mockImplementation(() => mockResponse({ status: 403, ok: false }));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('forbidden');
    });

    it('returns error with http reason on 5xx', async () => {
      reqMock.mockImplementation(() => mockResponse({ status: 503, ok: false }));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('error');
      expect(result.status === 'error' && result.reason).toBe('http');
      expect(result.status === 'error' && result.httpStatus).toBe(503);
    });

    it('returns error with parse reason on malformed JSON', async () => {
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.reject(new Error('Unexpected token')),
      }));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('error');
      expect(result.status === 'error' && result.reason).toBe('parse');
    });

    it('returns error with thrown reason when requestConfluence throws', async () => {
      reqMock.mockImplementation(() => Promise.reject(new Error('network')));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('error');
      expect(result.status === 'error' && result.reason).toBe('thrown');
    });

    it('falls back via _page.getPageId when currentPageId and Forge context are absent (mock returns 456)', async () => {
      wrapper.currentPageId = undefined;
      // Use 200 + empty results so the call goes through pageId-fallback and
      // returns the genuine no-key case (not the new 'page_not_found' for 404).
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [] }),
      }));
      const result = await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(result.status).toBe('not_found');
      expect(reqMock).toHaveBeenCalled();
    });

    // ZEN-1170 Defect 1 regression: graph editor doesn't call initializeContext()
    // before invoking this method, so currentPageId is undefined. Without the
    // pageId-fallback chain, every editor legacy load would falsely return
    // status='error' and falsely set legacyLoadBlocked=true, blocking save AND
    // failing to restore the legacy graph body.
    it('regression: derives pageId from forgeGlobal context when currentPageId is unset', async () => {
      wrapper.currentPageId = undefined;
      const forgeGlobalMod = await import('@/model/globals/forgeGlobal');
      (forgeGlobalMod.default as any).forgeContext = {
        extension: { content: { id: 'context-page-789' } },
      };
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [] }),
      }));
      await wrapper.getContentPropertyV2('zenuml-graph-macro-abc-body');
      expect(reqMock).toHaveBeenCalledWith(expect.stringContaining('/wiki/api/v2/pages/context-page-789/properties?key='));
      (forgeGlobalMod.default as any).forgeContext = null;
    });

    // ZEN-1170 Defect 1 regression: stored DiagramType.Unknown is a valid
    // enum string ('unknown') so a naive `restored.diagramType ?? ...`
    // passes it through, the renderer mounts nothing, and a downstream
    // save would persist CC with type='unknown' that hides the legacy
    // body. The forgeIndex.ts validity-gate treats Unknown the same as
    // missing and infers from populated content fields. This test pins
    // the discriminated-result contract that supports that flow.
    it('regression: returns ok for stored value with DiagramType.Unknown + mermaidCode (caller infers, not us)', async () => {
      const value = { diagramType: 'unknown', mermaidCode: 'graph TD; A-->B' };
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [{ value, version: { number: 1 } }] }),
      }));
      const result = await wrapper.getContentPropertyV2('zenuml-sequence-macro-abc-body');
      expect(result.status).toBe('ok');
      // We return what was stored; the validity-gate at the caller is
      // responsible for normalising Unknown → inferred type.
      expect(result.status === 'ok' && (result.property.value as any).diagramType).toBe('unknown');
      expect(result.status === 'ok' && (result.property.value as any).mermaidCode).toBe('graph TD; A-->B');
    });

    it('URL-encodes both pageId and key (V2 endpoint)', async () => {
      wrapper.currentPageId = 'page/with space';
      reqMock.mockImplementation(() => mockResponse({
        status: 200, ok: true,
        json: () => Promise.resolve({ results: [] }),
      }));
      await wrapper.getContentPropertyV2('zenuml-graph-macro-with/slash-body');
      expect(reqMock).toHaveBeenCalledWith(expect.stringMatching(/\/wiki\/api\/v2\/pages\/page%2Fwith%20space\/properties\?key=zenuml-graph-macro-with%2Fslash-body/));
    });
  });

  // --- Agent Link discovery (design §S3/S4) --------------------------------
  // Under the spec's forgeGlobal mock (isDiagramly=false, isLite=false), the
  // variant content types resolve to ac:com.zenuml.confluence-addon:*.
  describe('buildDiagramSearchTypesClause', () => {
    it('defaults to all variant content types when no types are given', () => {
      const clause = wrapper.buildDiagramSearchTypesClause();
      expect(clause).toBe(
        'type="ac:com.zenuml.confluence-addon:zenuml-content-sequence" or type="ac:com.zenuml.confluence-addon:zenuml-content-graph"',
      );
    });

    it('narrows to graph only when types=[graph]', () => {
      const clause = wrapper.buildDiagramSearchTypesClause(['graph']);
      expect(clause).toBe('type="ac:com.zenuml.confluence-addon:zenuml-content-graph"');
    });

    it('maps sequence-family types to the shared sequence content type', () => {
      // openapi lives under zenuml-content-sequence (not its own type).
      const clause = wrapper.buildDiagramSearchTypesClause(['openapi']);
      expect(clause).toBe('type="ac:com.zenuml.confluence-addon:zenuml-content-sequence"');
    });

    it('falls back to all variant types when the requested types map to nothing (never emits an empty clause)', () => {
      const clause = wrapper.buildDiagramSearchTypesClause(['flowchart']);
      expect(clause).toContain('zenuml-content-sequence');
      expect(clause).toContain('zenuml-content-graph');
    });
  });

  describe('buildDiagramSearchCql', () => {
    it('composes type clause + body text~ + space, recency-ordered', () => {
      const cql = wrapper.buildDiagramSearchCql({ query: 'payment', spaceKey: 'ENG' });
      expect(cql).toContain('text ~ "payment"');
      expect(cql).toContain('space="ENG"');
      expect(cql).toMatch(/order by lastmodified desc$/);
    });

    it('omits the text~ clause when there is no query (list mode)', () => {
      const cql = wrapper.buildDiagramSearchCql({});
      expect(cql).not.toContain('text ~');
      expect(cql).toMatch(/order by lastmodified desc$/);
    });

    it('neutralizes the closing quote so a query cannot break out of the text ~ "..." value', () => {
      const cql = wrapper.buildDiagramSearchCql({ query: 'a" or type="x' });
      // The query survives only as a single quoted literal — the injected `"`
      // is defused, so it never closes the value early to open a new clause.
      const textMatch = cql.match(/text ~ "([^"]*)"/);
      expect(textMatch).not.toBeNull();
      expect(cql.includes('a"')).toBe(false);
      // ` and ` only joins the type clause to the text clause (the injected
      // `type="x` did NOT become its own top-level clause).
      expect((cql.match(/ and /g) ?? []).length).toBe(1);
    });
  });

  describe('searchDiagramsForge', () => {
    it('runs the CQL search then body-enriches each hit with the exact diagramType + pageId', async () => {
      vi.mocked(forgeRequest).mockImplementation(async (url: string) => {
        if (url.startsWith('/wiki/rest/api/search')) {
          return {
            results: [
              {
                content: { id: '501', space: { key: 'ENG' } },
                excerpt: 'group @@@hl@@@Payment@@@endhl@@@Service',
                lastModified: '2026-07-01T00:00:00Z',
              },
            ],
          };
        }
        if (url === '/wiki/api/v2/custom-content/501?body-format=raw') {
          return {
            id: '501',
            title: 'Checkout flow',
            pageId: '900',
            body: { raw: { value: JSON.stringify({ diagramType: 'OpenAPI', code: 'x' }) } },
            version: { number: 4 },
          };
        }
        throw new Error(`Unexpected forgeRequest url: ${url}`);
      });

      const hits = await wrapper.searchDiagramsForge({ query: 'payment' });

      expect(hits).toEqual([
        {
          contentId: '501',
          title: 'Checkout flow',
          diagramType: 'OpenAPI',
          spaceKey: 'ENG',
          pageId: '900',
          excerpt: 'group PaymentService', // @@@hl@@@ markers stripped
          lastModified: '2026-07-01T00:00:00Z',
        },
      ]);
    });

    it('returns [] and swallows the error when the search call fails', async () => {
      vi.mocked(forgeRequest).mockRejectedValueOnce(new Error('search boom'));
      const hits = await wrapper.searchDiagramsForge({ query: 'x' });
      expect(hits).toEqual([]);
    });

    // Regression for spot-check #3, bug 1: the v1 search endpoint omits
    // content.space from the response unless the caller passes
    // expand=content.space — without it every row's spaceKey comes back "".
    // A mocked response that hand-supplies content.space (as the tests above
    // do) can't catch that; this asserts the actual request shape instead.
    it('requests expand=content.space so the live endpoint populates content.space', async () => {
      let requestedUrl = '';
      vi.mocked(forgeRequest).mockImplementation(async (url: string) => {
        requestedUrl = url;
        return { results: [] };
      });

      await wrapper.searchDiagramsForge({ query: 'payment' });

      expect(requestedUrl).toContain('expand=content.space');
    });

    it('maps content.space.key into spaceKey when the search response includes it', async () => {
      vi.mocked(forgeRequest).mockImplementation(async (url: string) => {
        if (url.startsWith('/wiki/rest/api/search')) {
          return {
            results: [
              {
                content: { id: '777', space: { key: 'MKT' } },
                excerpt: 'plain excerpt',
                lastModified: '2026-07-09T00:00:00Z',
              },
            ],
          };
        }
        if (url === '/wiki/api/v2/custom-content/777?body-format=raw') {
          return {
            id: '777',
            title: 'Marketing flow',
            pageId: '901',
            body: { raw: { value: JSON.stringify({ diagramType: 'sequence', code: 'x' }) } },
            version: { number: 1 },
          };
        }
        throw new Error(`Unexpected forgeRequest url: ${url}`);
      });

      const hits = await wrapper.searchDiagramsForge({ query: 'x' });

      expect(hits).toHaveLength(1);
      expect(hits[0].spaceKey).toBe('MKT');
    });
  });
});
