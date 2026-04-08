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
