import { describe, it, expect, vi, beforeEach } from 'vitest';
import ApWrapper2 from './ApWrapper2';
import { trackEvent } from '@/utils/window';
import { forgeRequest } from '@/utils/requestUtil';

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
});
