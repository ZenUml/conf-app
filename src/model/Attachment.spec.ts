import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define mocks before they're used in vi.mock factories
const { mockTrackEvent, mockApWrapper, mockGetContext, mockForgeRequest, mockCallRemote, mockRequestConfluence } = vi.hoisted(() => {
  const mockTrackEvent = vi.fn();
  const mockApWrapper = {
    _getCurrentPageId: vi.fn(),
    getAttachmentsV2: vi.fn(),
    request: vi.fn()
  };
  const mockGetContext = vi.fn();
  const mockForgeRequest = vi.fn();
  const mockCallRemote = vi.fn();
  const mockRequestConfluence = vi.fn();

  return {
    mockTrackEvent,
    mockApWrapper,
    mockGetContext,
    mockForgeRequest,
    mockCallRemote,
    mockRequestConfluence
  };
});

// Mock the DOM->PNG capture (model/captureBlob), which replaced the direct
// htmlToImage.toBlob() call — see model/captureBlob.ts for why.
vi.mock('@/model/captureBlob', () => ({
  captureBlob: vi.fn(),
  default: vi.fn()
}));

// Mock md5
vi.mock('md5', () => ({
  default: vi.fn((str) => `hash-${str}`)
}));

// Mock window utils
vi.mock('@/utils/window.ts', () => ({
  trackEvent: (...args: any[]) => mockTrackEvent(...args)
}));

// Mock globals
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: mockApWrapper
  }
}));

// Mock forgeGlobal
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: true
  },
  getContext: (...args: any[]) => mockGetContext(...args)
}));

// Mock requestUtil
vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: (...args: any[]) => mockForgeRequest(...args),
  callRemote: (...args: any[]) => mockCallRemote(...args)
}));

// Mock @forge/bridge
vi.mock('@forge/bridge', () => ({
  requestConfluence: (...args: any[]) => mockRequestConfluence(...args)
}));

import createAttachmentIfContentChanged from './Attachment';

import { captureBlob } from '@/model/captureBlob';
import md5 from 'md5';
import forgeGlobal from '@/model/globals/forgeGlobal';

describe('Attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window state
    delete (window as any).createAttachmentInProgress;
    // Setup default mocks for Forge
    mockGetContext.mockResolvedValue({
      extension: { config: { customContentId: 'test-uuid' } }
    });
    // ZEN-1170 Defect 1: createAttachmentIfContentChanged now reads
    // forgeGlobal.forgeContext directly to gate on customContentId — set
    // it here so all existing happy-path tests proceed past the guard.
    (forgeGlobal as any).forgeContext = {
      extension: { config: { customContentId: 'test-uuid' } },
    };
    mockApWrapper._getCurrentPageId.mockResolvedValue('page-123');
    mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
    // resolvePageStatus (#392) reads the page's real status on the 404-skip
    // path — the extension context never carries it in production.
    mockApWrapper.request.mockResolvedValue({ status: 'draft' });
    // Setup DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    (forgeGlobal as any).forgeContext = undefined;
    delete (window as any).createAttachmentInProgress;
  });

  describe('createAttachmentIfContentChanged', () => {
    it('should create new attachment when none exists', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'attachment-123' }] }))
      });
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('test content');

      expect(mockApWrapper._getCurrentPageId).toHaveBeenCalled();
      expect(mockApWrapper.getAttachmentsV2).toHaveBeenCalled();
      expect(md5).toHaveBeenCalledWith('test content');
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'version:1',
        'upload_attachment',
        'export',
        expect.objectContaining({
          custom_content_id: 'test-uuid',
          page_id: 'page-123',
          attachment_name: 'zenuml-test-uuid.png',
          content_hash: expect.stringContaining('hash-'),
        }),
      );
      // New attachment → 'created' success event with version 1
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'created',
        'attachment_upload_succeeded',
        'export',
        expect.objectContaining({
          custom_content_id: 'test-uuid',
          page_id: 'page-123',
          attachment_name: 'zenuml-test-uuid.png',
          version_number: 1,
          attachment_id: 'attachment-123',
        }),
      );
    });

    it('should update existing attachment when content hash changes', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);
      
      const existingAttachment = {
        id: 'attachment-123',
        version: { number: 2 },
        comment: 'hash-old-content'
      };
      // tryGetAttachment is called twice: once in createAttachmentIfContentChanged, once in uploadNewVersionOfAttachment
      mockApWrapper.getAttachmentsV2
        .mockResolvedValueOnce([existingAttachment]) // tryGetAttachment in createAttachmentIfContentChanged
        .mockResolvedValueOnce([existingAttachment]) // tryGetAttachment in uploadNewVersionOfAttachment
        .mockResolvedValueOnce([]); // getAttachmentsV2 in uploadAttachment2
      
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('success')
      });
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('new content'); // md5('new content') !== 'hash-old-content'

      expect(md5).toHaveBeenCalledWith('new content');
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'version:3',
        'upload_attachment',
        'export',
        expect.objectContaining({
          custom_content_id: 'test-uuid',
          page_id: 'page-123',
          attachment_name: 'zenuml-test-uuid.png',
        }),
      );
      // Existing attachment + content changed → 'updated' success event with bumped version
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'updated',
        'attachment_upload_succeeded',
        'export',
        expect.objectContaining({
          custom_content_id: 'test-uuid',
          page_id: 'page-123',
          version_number: 3,
          attachment_id: 'attachment-123',
        }),
      );
      expect(mockForgeRequest).toHaveBeenCalled(); // updateAttachmentProperties
    });

    it('should NOT emit attachment_upload_succeeded when the upload throws', async () => {
      // Regression guard: success must fire only after updateAttachmentProperties
      // resolves, so a thrown upload doesn't pollute the success denominator.
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      // Force the upload POST to throw via the multipart path
      mockRequestConfluence.mockRejectedValue(new Error('network down'));

      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow('network down');

      // _failed fires, _succeeded does NOT
      const succeededCalls = mockTrackEvent.mock.calls.filter(
        (c: unknown[]) => c[1] === 'attachment_upload_succeeded'
      );
      expect(succeededCalls).toHaveLength(0);
      const failedCalls = mockTrackEvent.mock.calls.filter(
        (c: unknown[]) => c[1] === 'attachment_upload_failed'
      );
      expect(failedCalls.length).toBeGreaterThan(0);

      consoleErrorSpy.mockRestore();
    });

    it('should skip upload when content hash matches existing attachment', async () => {
      const existingAttachment = {
        id: 'attachment-123',
        version: { number: 2 },
        comment: md5('test content')
      };
      // tryGetAttachment calls getAttachmentsV2 with the pageId and filename
      // It's called once in createAttachmentIfContentChanged
      // Make sure to reset the mock to avoid interference from previous tests
      mockApWrapper.getAttachmentsV2.mockReset();
      mockApWrapper.getAttachmentsV2.mockResolvedValue([existingAttachment]);

      await createAttachmentIfContentChanged('test content'); // md5('test content') === existingAttachment.comment

      // Should not make any upload requests since hash matches
      expect(mockRequestConfluence).not.toHaveBeenCalled();
      expect(mockForgeRequest).not.toHaveBeenCalled();
      // Should not call toPng either
      expect(captureBlob).not.toHaveBeenCalled();
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        expect.any(String),
        'attachment_upload_skipped',
        expect.any(String),
        expect.anything(),
      );
    });

    it('should prevent concurrent execution', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);
      
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'attachment-123' }] }))
      });
      mockForgeRequest.mockResolvedValue({});

      // Set flag to simulate concurrent execution
      (window as any).createAttachmentInProgress = true;

      await createAttachmentIfContentChanged('test content');

      // Concurrency guard short-circuits the upload itself.
      expect(mockRequestConfluence).not.toHaveBeenCalled();
      expect(mockForgeRequest).not.toHaveBeenCalled();
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        expect.any(String),
        'attachment_upload_skipped',
        expect.any(String),
        expect.anything(),
      );
    });

    it('should handle errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // buildUploadContext swallows _getCurrentPageId errors (so context is
      // best-effort), so to exercise the catch path we make the attachment
      // lookup throw instead.
      mockApWrapper.getAttachmentsV2.mockRejectedValue(new Error('API error'));

      // The function still throws so existing callers see the failure.
      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow('API error');
      // The flag should still be reset in the finally block
      expect((window as any).createAttachmentInProgress).toBe(false);
      // attachment_upload_failed event fires with join-key context.
      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.any(String),
        'attachment_upload_failed',
        'export',
        expect.objectContaining({
          custom_content_id: 'test-uuid',
          error_message: 'API error',
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should recover a viewer-only 403 via the app fallback (issue #166)', async () => {
      // The headline scenario: the viewing user lacks attachment-write
      // permission so the direct upload 403s. The frontend hands the PNG to the
      // /forge-upload-attachment remote, which writes as the app and succeeds.
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('Forbidden'),
      });
      mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'rescued-456', versionNumber: 1 });

      await expect(createAttachmentIfContentChanged('test content')).resolves.toBeUndefined();

      // The fallback was invoked against the right endpoint with a new-attachment
      // payload (no attachmentId) and the PNG transported as base64.
      expect(mockCallRemote).toHaveBeenCalledWith(
        '/forge-upload-attachment',
        'POST',
        expect.objectContaining({
          pageId: 'page-123',
          attachmentName: 'zenuml-test-uuid.png',
          pngBase64: expect.any(String),
        }),
      );
      expect(mockCallRemote).toHaveBeenCalledWith(
        '/forge-upload-attachment',
        'POST',
        expect.not.objectContaining({ attachmentId: expect.anything() }),
      );
      // Fallback started + succeeded both fired with the recovered status.
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'http_403',
        'attachment_upload_app_fallback_started',
        'export',
        expect.objectContaining({ recovered_from_status: 403 }),
      );
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'http_403',
        'attachment_upload_app_fallback_succeeded',
        'export',
        expect.objectContaining({ recovered_from_status: 403, fallback_attachment_id: 'rescued-456' }),
      );
      // Overall outcome is success — and flagged as a fallback so analysts can
      // measure recovery rate.
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'created',
        'attachment_upload_succeeded',
        'export',
        expect.objectContaining({ attachment_id: 'rescued-456', via_app_fallback: true }),
      );
      // No _failed should fire, and the user-side properties PUT must NOT run
      // (the app did the whole write, including the comment PUT).
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        expect.any(String), 'attachment_upload_failed', expect.any(String), expect.anything(),
      );
      expect(mockForgeRequest).not.toHaveBeenCalled();
    });

    it('should recover a 200-wrapped 403 body via the app fallback', async () => {
      // The most common observed shape: HTTP 200 OK with {"statusCode":403,...}
      // in the body. This previously slipped past the fallback entirely; now it
      // is surfaced as a 403 and recovered the same way as a real HTTP 403.
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ statusCode: 403, data: { authorized: true, valid: false } })
        ),
      });
      mockCallRemote.mockResolvedValue({ ok: true, attachmentId: 'rescued-789', versionNumber: 1 });

      await expect(createAttachmentIfContentChanged('test content')).resolves.toBeUndefined();

      expect(mockCallRemote).toHaveBeenCalledWith('/forge-upload-attachment', 'POST', expect.anything());
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'http_403',
        'attachment_upload_app_fallback_succeeded',
        'export',
        expect.objectContaining({ fallback_attachment_id: 'rescued-789' }),
      );
    });

    it('should label http_<status> when the app fallback ALSO fails', async () => {
      // Rare: the user 403s AND the app-side write is rejected too (would mean
      // the app's write:attachment scope doesn't cover this page). The fallback
      // failure is re-labelled with the same http_<status> scheme.
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('Forbidden'),
      });
      mockCallRemote.mockResolvedValue({ ok: false, status: 403, body: 'app forbidden too' });

      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow(
        /Confluence attachment API returned 403/
      );

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'http_403',
        'attachment_upload_app_fallback_started',
        'export',
        expect.objectContaining({ recovered_from_status: 403 }),
      );
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'http_403',
        'attachment_upload_failed',
        'export',
        expect.objectContaining({ custom_content_id: 'test-uuid', http_status: 403 }),
      );
      expect((window as any).createAttachmentInProgress).toBe(false);
      consoleErrorSpy.mockRestore();
    });

    it('should NOT invoke the app fallback on a 5xx (Forge function-quota guard)', async () => {
      // Only 401/403 (the viewer-permission cases) route to the resolver. 5xx,
      // network drops, parse errors must re-throw without spending a remote call.
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('server error'),
      });

      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow(
        /Confluence attachment API returned 500/
      );

      expect(mockCallRemote).not.toHaveBeenCalled();
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'http_500',
        'attachment_upload_failed',
        'export',
        expect.objectContaining({ http_status: 500 }),
      );
      consoleErrorSpy.mockRestore();
    });

    it('should label a non-Error throwable as non_error_thrown (not UnknownError)', async () => {
      // 70% of `attachment_upload_failed` events labelled `UnknownError` were
      // non-Error throwables (string, plain object, etc.) whose `.name` was
      // undefined.  Make sure the new label exposes that distinctly so future
      // analytics queries don't conflate them with real Errors.
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApWrapper.getAttachmentsV2.mockRejectedValue('boom'); // string, not Error

      await expect(createAttachmentIfContentChanged('test content')).rejects.toBe('boom');

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'non_error_thrown',
        'attachment_upload_failed',
        'export',
        expect.objectContaining({
          custom_content_id: 'test-uuid',
          error_name: 'string',
          error_message: 'boom',
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    // #392 — failure attribution. Before these, a failure recorded after the
    // app fallback ran was indistinguishable from a plain user-side one, and a
    // post-fallback 404 (the app cannot see the page — 59% of fallback
    // failures per #211) was swallowed by the benign 404-skip branch.
    describe('app-fallback failure attribution (#392)', () => {
      const setUpFallbackFailure = (backendStatus: number, backendBody: string) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
        // User-side write is denied -> the app fallback runs...
        mockRequestConfluence.mockResolvedValue({
          ok: false,
          status: 403,
          text: vi.fn().mockResolvedValue('Forbidden'),
        });
        // ...and the app's own write fails too.
        mockCallRemote.mockResolvedValue({ ok: false, status: backendStatus, body: backendBody });
      };

      it('records a post-fallback 404 as app_no_access, NOT a benign skip', async () => {
        setUpFallbackFailure(
          404,
          JSON.stringify({
            statusCode: 404,
            data: { authorized: true, valid: true, errors: [], successful: true },
            message: 'com.atlassian.confluence.api.service.exceptions.api.NotFoundException: No content found',
          }),
        );

        await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow(/404/);

        // The whole point: this must NOT land in the unpublished-parent bucket.
        const skipped = mockTrackEvent.mock.calls.filter(
          (c: unknown[]) => c[1] === 'attachment_upload_skipped',
        );
        expect(skipped).toHaveLength(0);
        expect(mockTrackEvent).toHaveBeenCalledWith(
          'app_no_access',
          'attachment_upload_failed',
          'export',
          expect.objectContaining({
            http_status: 404,
            via_app_fallback: true,
            fallback_from_status: 403,
            confluence_error_class: 'NotFoundException',
          }),
        );
      });

      it('stamps via_app_fallback on a post-fallback 403 too', async () => {
        setUpFallbackFailure(
          403,
          JSON.stringify({
            statusCode: 403,
            message: 'com.atlassian.confluence.api.service.exceptions.api.PermissionException: denied',
          }),
        );

        await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow(/403/);

        expect(mockTrackEvent).toHaveBeenCalledWith(
          'http_403',
          'attachment_upload_failed',
          'export',
          expect.objectContaining({
            via_app_fallback: true,
            fallback_from_status: 403,
            confluence_error_class: 'PermissionException',
          }),
        );
      });

      it('marks a plain user-side failure as via_app_fallback: false', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
        // 5xx never routes to the fallback.
        mockRequestConfluence.mockResolvedValue({
          ok: false,
          status: 503,
          text: vi.fn().mockResolvedValue('unavailable'),
        });

        await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow(/503/);

        expect(mockCallRemote).not.toHaveBeenCalled();
        expect(mockTrackEvent).toHaveBeenCalledWith(
          'http_503',
          'attachment_upload_failed',
          'export',
          expect.objectContaining({ via_app_fallback: false }),
        );
      });
    });

    // #392 — the 200-char error_message budget was entirely consumed by the
    // Confluence error envelope, truncating the reason mid-class-name.
    it('records the Confluence message, not the envelope, in error_message', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            statusCode: 400,
            data: { authorized: true, valid: true, errors: [], successful: true },
            message:
              'com.atlassian.confluence.api.service.exceptions.api.BadRequestException: Cannot add a new attachment with same file name as an existing attachment',
          }),
        ),
      });

      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow();

      const failed = mockTrackEvent.mock.calls.find(
        (c: unknown[]) => c[1] === 'attachment_upload_failed',
      );
      const props = failed?.[3] as Record<string, unknown>;
      expect(props.confluence_error_class).toBe('BadRequestException');
      // The actionable tail survives the 200-char cap now that the ~180-char
      // envelope is gone.
      expect(String(props.error_message)).toContain('same file name as an existing attachment');
      expect(String(props.error_message)).not.toContain('"authorized"');
    });

    it('salvages the message from a truncated envelope (backend relays 500 chars)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('Forbidden'),
      });
      // Unparseable JSON — cut mid-string, exactly as the backend's 500-char
      // body cap produces.
      mockCallRemote.mockResolvedValue({
        ok: false,
        status: 403,
        body: '{"statusCode":403,"data":{"authorized":true},"message":"com.atlassian.confluence.api.service.exceptions.api.PermissionException: user not permitted to cre',
      });

      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow();

      const failed = mockTrackEvent.mock.calls.find(
        (c: unknown[]) => c[1] === 'attachment_upload_failed',
      );
      const props = failed?.[3] as Record<string, unknown>;
      expect(props.confluence_error_class).toBe('PermissionException');
      expect(String(props.error_message)).toContain('user not permitted');
    });

    // #392 — content_status was undefined on 100% of skipped events because it
    // came from an extension context that never carries it, so the "a 404 on a
    // published page is a real regression" guard rail could never fire.
    it('resolves content_status from the API on the 404 skip path', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockApWrapper.request.mockResolvedValue({ status: 'current' });
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('not found'),
      });

      await expect(createAttachmentIfContentChanged('test content')).resolves.toBeUndefined();

      expect(mockApWrapper.request).toHaveBeenCalledWith('/api/v2/pages/page-123');
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'unpublished_parent',
        'attachment_upload_skipped',
        'export',
        // 'current' here is the regression signal: the parent IS published, so
        // "unpublished parent" is the wrong explanation for this 404.
        expect.objectContaining({ http_status: 404, content_status: 'current' }),
      );
    });

    it('degrades to unknown when the page-status read fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockApWrapper.request.mockRejectedValue(new Error('network down'));
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('not found'),
      });

      // Diagnostic only — must never turn a skip into a failure.
      await expect(createAttachmentIfContentChanged('test content')).resolves.toBeUndefined();

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'unpublished_parent',
        'attachment_upload_skipped',
        'export',
        expect.objectContaining({ content_status: 'unknown' }),
      );
    });

    it('should skip upload when page is a draft (Option A — context status check)', async () => {
      // Simulate the inline-edit-canvas preview context where isDisplayMode() returns
      // true but the page hasn't been published yet.
      (forgeGlobal as any).forgeContext = {
        extension: {
          content: { status: 'draft' },
          config: { customContentId: 'test-uuid' },
        }
      };

      await createAttachmentIfContentChanged('test content');

      // Must not touch the attachment API at all
      expect(mockRequestConfluence).not.toHaveBeenCalled();
      expect(mockForgeRequest).not.toHaveBeenCalled();
      expect(captureBlob).not.toHaveBeenCalled();
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        expect.any(String),
        'attachment_upload_skipped',
        expect.any(String),
        expect.anything(),
      );

      // Cleanup
      delete (forgeGlobal as any).forgeContext;
    });

    it('should skip (not fail) on the wrapped draft-page 404 (Option B — "status : draft" body)', async () => {
      // Option A guard won't fire because status is not 'draft' in context
      (forgeGlobal as any).forgeContext = {
        extension: {
          content: { status: 'current' },
          config: { customContentId: 'test-uuid' },
        }
      };

      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      // Confluence v1 wraps the draft 404 inside a 200 body
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            statusCode: 404,
            message: 'No content found with id : ContentId{id=123} and status [current], there is a content object with status : draft'
          })
        )
      });

      // Should NOT throw — DraftPageError is caught and treated as non-fatal
      await expect(createAttachmentIfContentChanged('test content')).resolves.toBeUndefined();

      // Reclassified as a benign skip (draft_page), NOT a hard http_404 failure.
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'draft_page',
        'attachment_upload_skipped',
        'export',
        expect.objectContaining({ custom_content_id: 'test-uuid', http_status: 404 }),
      );
      const failedCalls = mockTrackEvent.mock.calls.filter((c: unknown[]) => c[1] === 'attachment_upload_failed');
      expect(failedCalls).toHaveLength(0);
      // The concurrency flag must be released even on the non-fatal path
      expect((window as any).createAttachmentInProgress).toBe(false);

      // Cleanup
      delete (forgeGlobal as any).forgeContext;
    });

    it('should skip (not fail) on the generic wrapped 404 NotFoundException (the production shape)', async () => {
      // This is the body that dominated the http_404 class in production — a
      // 200-wrapped 404 whose message is a bare NotFoundException, NOT the
      // "status : draft" string the old guard matched. It fired against an
      // unpublished parent (in-editor inline preview / pre-view.submit save).
      (forgeGlobal as any).forgeContext = {
        extension: {
          content: { status: 'current', type: 'page' },
          config: { customContentId: 'test-uuid' },
        },
      };

      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            statusCode: 404,
            data: { authorized: true, valid: true, errors: [], successful: true },
            message: 'com.atlassian.confluence.api.service.exceptions.api.NotFoundException: No content found with id',
          }),
        ),
      });

      // Non-fatal: resolves, does NOT throw, does NOT count as a failure.
      await expect(createAttachmentIfContentChanged('test content', 'mermaid')).resolves.toBeUndefined();

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'unpublished_parent',
        'attachment_upload_skipped',
        'export',
        expect.objectContaining({ custom_content_id: 'test-uuid', http_status: 404, content_status: 'current' }),
      );
      const failedCalls = mockTrackEvent.mock.calls.filter((c: unknown[]) => c[1] === 'attachment_upload_failed');
      expect(failedCalls).toHaveLength(0);
      expect((window as any).createAttachmentInProgress).toBe(false);

      delete (forgeGlobal as any).forgeContext;
    });

    it('should skip (not fail) on a real HTTP 404 from the attachment POST', async () => {
      // The non-wrapped path: Confluence answers a genuine HTTP 404 (response.ok
      // false). makeRequest throws AttachmentUploadHttpError(404); the outer
      // catch must treat it as the same benign unpublished-parent skip.
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('Not Found'),
      });

      await expect(createAttachmentIfContentChanged('test content', 'mermaid')).resolves.toBeUndefined();

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'unpublished_parent',
        'attachment_upload_skipped',
        'export',
        expect.objectContaining({ http_status: 404 }),
      );
      const failedCalls = mockTrackEvent.mock.calls.filter((c: unknown[]) => c[1] === 'attachment_upload_failed');
      expect(failedCalls).toHaveLength(0);
      // A 404 must never spend the app-fallback remote (only 401/403 do).
      expect(mockCallRemote).not.toHaveBeenCalled();
      expect((window as any).createAttachmentInProgress).toBe(false);
    });

    // the hash comparison happens before any Forge/Connect branching, so behavior should be identical
    it('should work in Forge mode', async () => {
      forgeGlobal.isForge = true;
      mockGetContext.mockResolvedValue({
        extension: {
          config: {
            customContentId: 'forge-content-id'
          }
        }
      });

      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);
      
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      
      const mockResponse = {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'attachment-123' }] }))
      };
      mockRequestConfluence.mockResolvedValue(mockResponse);
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('test content');

      expect(mockGetContext).toHaveBeenCalled();
      expect(mockRequestConfluence).toHaveBeenCalled();
      expect(mockForgeRequest).toHaveBeenCalled(); // updateAttachmentProperties
    });

    // ── #212: save-path override (opts.customContentId / opts.fromSave) ──────
    // The editor save handler calls this for a JUST-SAVED macro whose id the
    // editor context does NOT yet carry. opts.customContentId supplies that id
    // explicitly and must drive the guard, the lookup filename, the upload name,
    // and the telemetry — independent of getContext()/forgeContext.
    describe('opts.customContentId override (save path)', () => {
      beforeEach(() => {
        // Simulate the NEW-macro editor: neither getContext() nor forgeContext
        // carries a customContentId yet. Without the override the central guard
        // would short-circuit and nothing would upload.
        mockGetContext.mockResolvedValue({ extension: { config: {} } });
        (forgeGlobal as any).forgeContext = { extension: { config: {} } };
      });

      it('uses the override id for the lookup, upload name, and telemetry even when context has no id', async () => {
        const mockBlob = new Blob(['test'], { type: 'image/png' });
        vi.mocked(captureBlob).mockResolvedValue(mockBlob);
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
        mockRequestConfluence.mockResolvedValue({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'att-saved-1' }] })),
        });
        mockForgeRequest.mockResolvedValue({});

        await createAttachmentIfContentChanged('test content', 'sequence', {
          customContentId: 'saved-id-999',
        });

        // Lookup uses the override-derived filename, not zenuml-undefined.png.
        expect(mockApWrapper.getAttachmentsV2).toHaveBeenCalledWith('page-123', {
          filename: 'zenuml-saved-id-999.png',
        });
        // Success telemetry carries the override id + name.
        expect(mockTrackEvent).toHaveBeenCalledWith(
          'created',
          'attachment_upload_succeeded',
          'export',
          expect.objectContaining({
            custom_content_id: 'saved-id-999',
            attachment_name: 'zenuml-saved-id-999.png',
            attachment_id: 'att-saved-1',
          }),
        );
      });

      it('routes save-time uploads through the async backend and emits attachment_upload_queued', async () => {
        // perf/publish-async-backup: fromSave no longer blocks on the user-side
        // POST + PUT. It hands the PNG to /forge-upload-attachment in async mode;
        // the backend acks { ok:true, queued:true } and finishes in waitUntil.
        const mockBlob = new Blob(['test'], { type: 'image/png' });
        vi.mocked(captureBlob).mockResolvedValue(mockBlob);
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
        mockCallRemote.mockResolvedValue({ ok: true, queued: true });

        await createAttachmentIfContentChanged('test content', 'sequence', {
          customContentId: 'saved-id-1000',
          fromSave: true,
        });

        // Went through the app-async backend with async:true — NOT the user POST.
        expect(mockCallRemote).toHaveBeenCalledWith(
          '/forge-upload-attachment',
          'POST',
          expect.objectContaining({ async: true, attachmentName: 'zenuml-saved-id-1000.png' }),
        );
        expect(mockRequestConfluence).not.toHaveBeenCalled();

        // Emits a queued (not succeeded) signal carrying from_save:true.
        const queued = mockTrackEvent.mock.calls.find(
          (c: unknown[]) => c[1] === 'attachment_upload_queued',
        );
        expect(queued).toBeDefined();
        expect(queued![3]).toMatchObject({ from_save: true, custom_content_id: 'saved-id-1000' });
        const succeeded = mockTrackEvent.mock.calls.find(
          (c: unknown[]) => c[1] === 'attachment_upload_succeeded',
        );
        expect(succeeded).toBeUndefined();
      });

      it('does NOT set from_save when opts.fromSave is absent', async () => {
        const mockBlob = new Blob(['test'], { type: 'image/png' });
        vi.mocked(captureBlob).mockResolvedValue(mockBlob);
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
        mockRequestConfluence.mockResolvedValue({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'att-saved-3' }] })),
        });
        mockForgeRequest.mockResolvedValue({});

        await createAttachmentIfContentChanged('test content', 'sequence', {
          customContentId: 'saved-id-1001',
        });

        const succeeded = mockTrackEvent.mock.calls.find(
          (c: unknown[]) => c[1] === 'attachment_upload_succeeded',
        );
        expect(succeeded).toBeDefined();
        expect(succeeded![3]).not.toHaveProperty('from_save');
      });

      it('still skips (guard) when no override AND context has no customContentId', async () => {
        const mockBlob = new Blob(['test'], { type: 'image/png' });
        vi.mocked(captureBlob).mockResolvedValue(mockBlob);
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);

        await createAttachmentIfContentChanged('test content', 'sequence');

        // Central guard short-circuits before any lookup/upload.
        expect(mockApWrapper.getAttachmentsV2).not.toHaveBeenCalled();
        expect(mockRequestConfluence).not.toHaveBeenCalled();
        const succeeded = mockTrackEvent.mock.calls.filter(
          (c: unknown[]) => c[1] === 'attachment_upload_succeeded',
        );
        expect(succeeded).toHaveLength(0);
      });
    });

    // A dashboard modal ("My API Documents" → View/Edit) carries the id on
    // extension.modal, not extension.config, and has no page. Before the id
    // read was widened to resolveEffectiveCustomContentId it returned early
    // purely because the config id was empty; the page check keeps that surface
    // silent for its own reason rather than as a side effect.
    describe('page-context guard', () => {
      beforeEach(() => {
        vi.mocked(captureBlob).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      });

      it('skips the write in a dashboard modal, which has an id but no page', async () => {
        (forgeGlobal as any).forgeContext = {
          extension: { modal: { customContentId: 'dashboard-doc-1' } },
        };
        mockApWrapper._getCurrentPageId.mockResolvedValue('');

        await createAttachmentIfContentChanged('test content', 'openapi');

        expect(mockApWrapper.getAttachmentsV2).not.toHaveBeenCalled();
        expect(mockRequestConfluence).not.toHaveBeenCalled();
        const failed = mockTrackEvent.mock.calls.filter(
          (c: unknown[]) => c[1] === 'attachment_upload_failed',
        );
        expect(failed).toHaveLength(0);
      });

      it('skips rather than throwing when the page id lookup itself fails', async () => {
        (forgeGlobal as any).forgeContext = {
          extension: { modal: { customContentId: 'dashboard-doc-2' } },
        };
        mockApWrapper._getCurrentPageId.mockRejectedValue(new Error('no page context'));

        await expect(
          createAttachmentIfContentChanged('test content', 'openapi'),
        ).resolves.toBeUndefined();
        expect(mockRequestConfluence).not.toHaveBeenCalled();
      });

      it('still writes when a page IS in context', async () => {
        (forgeGlobal as any).forgeContext = {
          extension: { config: { customContentId: 'test-uuid' }, content: { id: 'page-123' } },
        };
        mockApWrapper._getCurrentPageId.mockResolvedValue('page-123');

        await createAttachmentIfContentChanged('test content', 'sequence');

        expect(mockApWrapper.getAttachmentsV2).toHaveBeenCalled();
      });
    });
  });

  describe('createAttachmentIfContentChanged - PNG capture', () => {
    it('should convert iframe to PNG via postMessage', async () => {
      const mockBlob = new Blob(['png data'], { type: 'image/png' });
      const mockIframe = document.createElement('iframe');
      mockIframe.id = 'mainFrame';
      
      // Mock contentWindow using Object.defineProperty since it's read-only
      const mockPostMessage = vi.fn();
      const mockContentWindow = {
        postMessage: mockPostMessage,
        location: { href: 'http://different-origin.com' }
      };
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: mockContentWindow,
        writable: false,
        configurable: true
      });
      
      document.body.appendChild(mockIframe);

      // Set up mocks for the attachment creation flow
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'attachment-123' }] }))
      });
      mockForgeRequest.mockResolvedValue({});

      // Start the function which will wait for the iframe message
      const pngPromise = createAttachmentIfContentChanged('test content');
      
      // Wait a bit for the function to set up the message listener
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Simulate message from iframe with different origin
      // The code checks: source.location.href !== window.location.href
      const mockSource = {
        location: { href: 'http://different-origin.com' }
      };
      const event = new MessageEvent('message', {
        data: { action: 'export.result', data: mockBlob },
        source: mockSource as any,
        origin: 'http://different-origin.com'
      });
      window.dispatchEvent(event);

      // Wait for the promise to resolve
      await pngPromise;

      // Verify iframe was found and postMessage was called
      expect(document.getElementById('mainFrame')).toBeTruthy();
      // postMessage is called with '*' as targetOrigin for cross-origin compatibility
      expect(mockPostMessage).toHaveBeenCalledWith({ action: 'export' }, '*');
    });

    it('should convert DOM element to PNG via html-to-image', async () => {
      const mockBlob = new Blob(['png data'], { type: 'image/png' });
      vi.mocked(captureBlob).mockResolvedValue(mockBlob);

      const mockElement = document.createElement('div');
      mockElement.className = 'screen-capture-content';
      document.body.appendChild(mockElement);

      // Test through createAttachmentIfContentChanged which calls toPng
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'attachment-123' }] }))
      });
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('test content');

      expect(captureBlob).toHaveBeenCalledWith(mockElement, { backgroundColor: 'white', skipFonts: true });
    });

    it('treats a toPng (html-to-image) async rejection as a clean capture skip, not an upload failure', async () => {
      // Remove the iframe so toPng uses the html-to-image path
      document.body.innerHTML = '';
      const mockElement = document.createElement('div');
      mockElement.className = 'screen-capture-content';
      document.body.appendChild(mockElement);

      // html-to-image rejects (its offscreen image throws a DOM `error` Event —
      // the root of the `[object Event]` / non_error_thrown failures).
      vi.mocked(captureBlob).mockRejectedValue(new Error('Conversion failed'));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);

      // toPng now AWAITs + catches the async rejection -> undefined -> ToPngError,
      // which createAttachment treats as a SKIP. It resolves, does not throw.
      await expect(createAttachmentIfContentChanged('test content')).resolves.toBeUndefined();

      // Recorded as a convert_to_png capture error — NOT a mislabeled
      // attachment_upload_failed / non_error_thrown.
      expect(mockTrackEvent).toHaveBeenCalledWith('toPng_failed', 'convert_to_png', 'error');
      expect(mockTrackEvent).toHaveBeenCalledWith('toPng', 'convert_to_png', 'export');
      const failedCalls = mockTrackEvent.mock.calls.filter((c: unknown[]) => c[1] === 'attachment_upload_failed');
      expect(failedCalls).toHaveLength(0);
      expect((window as any).createAttachmentInProgress).toBe(false);
    });

    it('bounds a hung html-to-image toBlob() with a timeout, so the capture fails instead of hanging forever', async () => {
      vi.useFakeTimers();
      try {
        // Remove the iframe so toPng uses the html-to-image path
        document.body.innerHTML = '';
        const mockElement = document.createElement('div');
        mockElement.className = 'screen-capture-content';
        document.body.appendChild(mockElement);

        // Reproduces the lite-stg hang: toBlob()'s returned promise never
        // settles (neither resolves nor rejects).
        vi.mocked(captureBlob).mockImplementation(() => new Promise(() => {}));
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);

        const pending = createAttachmentIfContentChanged('test content');
        // Let the pending assertions below queue before advancing fake time.
        const flush = expect(pending).resolves.toBeUndefined();

        // Advance past the capture timeout — must resolve, not hang.
        await vi.advanceTimersByTimeAsync(15_000);
        await flush;

        // Timeout is recorded under its own label so it's countable separately
        // from other convert_to_png capture failures (e.g. a DOM error Event).
        expect(mockTrackEvent).toHaveBeenCalledWith('toPng_timeout', 'convert_to_png', 'error');
        expect(mockTrackEvent).toHaveBeenCalledWith('toPng', 'convert_to_png', 'export');
        const failedCalls = mockTrackEvent.mock.calls.filter((c: unknown[]) => c[1] === 'attachment_upload_failed');
        expect(failedCalls).toHaveLength(0);
        const genericFailure = mockTrackEvent.mock.calls.filter(
          (c: unknown[]) => c[0] === 'toPng_failed' && c[1] === 'convert_to_png'
        );
        expect(genericFailure).toHaveLength(0);
        // The whole point of the guard: the in-progress flag must not stay
        // stuck true, which would silently block every subsequent save.
        expect((window as any).createAttachmentInProgress).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    // ── PlantUML server-PNG fetch (fixes the ~81% [object Event] capture fail) ──
    it('PlantUML: captures the backup via the server PNG fetch, not html-to-image', async () => {
      const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: 'image/png' });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(pngBlob) });
      vi.stubGlobal('fetch', fetchMock);
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true, status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'att-pu-1' }] })),
      });
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('@startuml\nA->B\n@enduml', 'plantuml');

      // Backup came from the PlantUML PNG server — html-to-image NOT used.
      expect(fetchMock).toHaveBeenCalled();
      expect(String(fetchMock.mock.calls[0][0])).toContain('plantuml.com/plantuml/png/');
      expect(captureBlob).not.toHaveBeenCalled();
      expect(mockTrackEvent).toHaveBeenCalledWith('plantuml_server_png', 'convert_to_png', 'export');
      expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'attachment_upload_succeeded')).toBeDefined();
      vi.unstubAllGlobals();
    });

    it('PlantUML: falls back to html-to-image when the server returns a non-PNG body', async () => {
      const notPng = new Blob([new Uint8Array([0x3c, 0x73, 0x76, 0x67])], { type: 'image/svg+xml' }); // "<svg"
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(notPng) }));
      document.body.innerHTML = '';
      const el = document.createElement('div'); el.className = 'screen-capture-content'; document.body.appendChild(el);
      vi.mocked(captureBlob).mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true, status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'att-pu-2' }] })),
      });
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('@startuml\nA->B\n@enduml', 'plantuml');

      // Server fetch rejected (non-PNG) -> fell back to the DOM capture, still uploaded.
      expect(captureBlob).toHaveBeenCalled();
      expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'attachment_upload_succeeded')).toBeDefined();
      vi.unstubAllGlobals();
    });

    it('PlantUML: never hits the server when the content is not PlantUML (mismatched content/type pair)', async () => {
      // Regression: a doc converted from the default sequence template keeps
      // its ZenUML `code` field; callers passing that leftover body with
      // diagramType 'plantuml' used to fire a guaranteed-400 request at
      // plantuml.com/plantuml/png/. capturePng must skip the server fetch for
      // any body that doesn't start with @start... and go straight to the DOM
      // capture.
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, blob: () => Promise.resolve(new Blob()) });
      vi.stubGlobal('fetch', fetchMock);
      document.body.innerHTML = '';
      const el = document.createElement('div'); el.className = 'screen-capture-content'; document.body.appendChild(el);
      vi.mocked(captureBlob).mockResolvedValue(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockRequestConfluence.mockResolvedValue({
        ok: true, status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'att-pu-3' }] })),
      });
      mockForgeRequest.mockResolvedValue({});

      const zenumlLeftover = 'title Order Service\nOrderController.post(payload) {\n  OrderService.create(payload)\n}';
      await createAttachmentIfContentChanged(zenumlLeftover, 'plantuml');

      // No request to the PlantUML server at all — mismatch detected up front.
      const plantumlCalls = fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]).includes('plantuml.com'));
      expect(plantumlCalls).toHaveLength(0);
      expect(mockTrackEvent).toHaveBeenCalledWith('plantuml_server_png_skipped_content_mismatch', 'convert_to_png', 'warning');
      // Fell back to the DOM capture and the upload still succeeded.
      expect(captureBlob).toHaveBeenCalled();
      expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'attachment_upload_succeeded')).toBeDefined();
      vi.unstubAllGlobals();
    });

    // ── PlantUML dpi upscale (fixes pixelated small-diagram exports) ──
    describe('PlantUML dpi upscale', () => {
      /** Header-only fake PNG (not a decodable image) — enough for the IHDR-reading upscale logic. */
      function fakePng(width: number, height: number): Blob {
        const bytes = new Uint8Array(24);
        bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
        const view = new DataView(bytes.buffer);
        view.setUint32(8, 13, false);
        bytes.set([73, 72, 68, 82], 12); // 'IHDR'
        view.setUint32(16, width, false);
        view.setUint32(20, height, false);
        return new Blob([bytes], { type: 'image/png' });
      }

      beforeEach(() => {
        mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
        mockRequestConfluence.mockResolvedValue({
          ok: true, status: 200,
          text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'att-pu-dpi' }] })),
        });
        mockForgeRequest.mockResolvedValue({});
      });

      it('re-fetches at a higher dpi when the natural PNG is under the target width, and uploads the upscaled result', async () => {
        // Real staging sample: a tiny 3-line diagram renders 95x129 at 96 dpi.
        const natural = fakePng(95, 129);
        const upscaled = fakePng(1400, 1900);
        const fetchMock = vi.fn()
          .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(natural) })
          .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(upscaled) });
        vi.stubGlobal('fetch', fetchMock);

        await createAttachmentIfContentChanged('@startuml\nA->B\n@enduml', 'plantuml');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        // Second request's encoded payload differs from the first (dpi directive injected).
        expect(fetchMock.mock.calls[1][0]).not.toBe(fetchMock.mock.calls[0][0]);
        expect(mockTrackEvent).toHaveBeenCalledWith('plantuml_server_png_upscaled', 'convert_to_png', 'export');
        expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'attachment_upload_succeeded')).toBeDefined();
        vi.unstubAllGlobals();
      });

      it('skips the upscale re-fetch when the natural PNG already meets the target width', async () => {
        const natural = fakePng(1500, 400); // already >= TARGET_WIDTH_PX
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(natural) });
        vi.stubGlobal('fetch', fetchMock);

        await createAttachmentIfContentChanged('@startuml\nA->B\n@enduml', 'plantuml');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'plantuml_server_png_upscaled')).toBeUndefined();
        vi.unstubAllGlobals();
      });

      it('skips the upscale re-fetch when the source has leading whitespace so the dpi directive would not match (no false "upscaled" event)', async () => {
        // validate.ts trims before checking @startuml, so leading whitespace
        // is storable content. withDpiDirective's regex is anchored to the
        // very first character — this content never gets the directive.
        const natural = fakePng(95, 129);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(natural) });
        vi.stubGlobal('fetch', fetchMock);

        await createAttachmentIfContentChanged('  @startuml\nA->B\n@enduml', 'plantuml');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'plantuml_server_png_upscaled')).toBeUndefined();
        vi.unstubAllGlobals();
      });

      it('treats a re-fetch that comes back no wider than natural as a failed upscale, not a false success', async () => {
        const natural = fakePng(95, 129);
        // Server ignored/rejected the injected dpi directive — same size back.
        const sameSize = fakePng(95, 129);
        const fetchMock = vi.fn()
          .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(natural) })
          .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(sameSize) });
        vi.stubGlobal('fetch', fetchMock);

        await createAttachmentIfContentChanged('@startuml\nA->B\n@enduml', 'plantuml');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(mockTrackEvent).toHaveBeenCalledWith('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
        expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'plantuml_server_png_upscaled')).toBeUndefined();
        expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'attachment_upload_succeeded')).toBeDefined();
        vi.unstubAllGlobals();
      });

      it('falls back to the natural-size PNG when the upscale re-fetch fails, without failing the upload', async () => {
        const natural = fakePng(95, 129);
        const fetchMock = vi.fn()
          .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(natural) })
          .mockResolvedValueOnce({ ok: false, status: 500, blob: () => Promise.resolve(new Blob()) });
        vi.stubGlobal('fetch', fetchMock);

        await createAttachmentIfContentChanged('@startuml\nA->B\n@enduml', 'plantuml');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(mockTrackEvent).toHaveBeenCalledWith('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
        expect(captureBlob).not.toHaveBeenCalled();
        expect(mockTrackEvent.mock.calls.find((c: unknown[]) => c[1] === 'attachment_upload_succeeded')).toBeDefined();
        vi.unstubAllGlobals();
      });
    });
  });

});
