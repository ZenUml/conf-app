import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define mocks before they're used in vi.mock factories
const { mockTrackEvent, mockApWrapper, mockGetContext, mockForgeRequest, mockRequestConfluence } = vi.hoisted(() => {
  const mockTrackEvent = vi.fn();
  const mockApWrapper = {
    _getCurrentPageId: vi.fn(),
    getAttachmentsV2: vi.fn()
  };
  const mockGetContext = vi.fn();
  const mockForgeRequest = vi.fn();
  const mockRequestConfluence = vi.fn();
  
  return {
    mockTrackEvent,
    mockApWrapper,
    mockGetContext,
    mockForgeRequest,
    mockRequestConfluence
  };
});

// Mock html-to-image
vi.mock('html-to-image', () => ({
  default: {
    toBlob: vi.fn()
  },
  toBlob: vi.fn()
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
  forgeRequest: (...args: any[]) => mockForgeRequest(...args)
}));

// Mock @forge/bridge
vi.mock('@forge/bridge', () => ({
  requestConfluence: (...args: any[]) => mockRequestConfluence(...args)
}));

import { getAttachmentDownloadLink } from './Attachment';
import createAttachmentIfContentChanged from './Attachment';

import * as htmlToImage from 'html-to-image';
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
    mockApWrapper._getCurrentPageId.mockResolvedValue('page-123');
    mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
    // Setup DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    delete (window as any).createAttachmentInProgress;
  });

  describe('getAttachmentDownloadLink', () => {
    it('should return download link when attachment exists', async () => {
      const mockAttachment = {
        _links: {
          base: 'https://example.com',
          download: '/download/attachment.png'
        }
      };
      mockApWrapper.getAttachmentsV2.mockResolvedValue([mockAttachment]);

      const link = await getAttachmentDownloadLink('page-123', 'test-uuid');
      expect(link).toBe('https://example.com/download/attachment.png');
      expect(mockApWrapper.getAttachmentsV2).toHaveBeenCalledWith('page-123', { filename: 'zenuml-test-uuid.png' });
    });

    it('should return undefined when no attachment found', async () => {
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);

      const link = await getAttachmentDownloadLink('page-123', 'test-uuid');
      // Returns 0 (falsy) when attachments.length is 0
      expect(link).toBeFalsy();
    });

    it('should handle multiple attachments and return first one', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockAttachment1 = {
        _links: {
          base: 'https://example.com',
          download: '/download/attachment1.png'
        }
      };
      const mockAttachment2 = {
        _links: {
          base: 'https://example.com',
          download: '/download/attachment2.png'
        }
      };
      mockApWrapper.getAttachmentsV2.mockResolvedValue([mockAttachment1, mockAttachment2]);

      const link = await getAttachmentDownloadLink('page-123', 'test-uuid');
      expect(link).toBe('https://example.com/download/attachment1.png');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Multiple attachments found'),
        [mockAttachment1, mockAttachment2]
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('createAttachmentIfContentChanged', () => {
    it('should create new attachment when none exists', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(htmlToImage.toBlob).mockResolvedValue(mockBlob);
      
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockApRequest.mockResolvedValue({
        body: JSON.stringify({ results: [{ id: 'attachment-123' }] })
      });
      mockConnectRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('test content');

      expect(mockApWrapper._getCurrentPageId).toHaveBeenCalled();
      expect(mockApWrapper.getAttachmentsV2).toHaveBeenCalled();
      expect(md5).toHaveBeenCalledWith('test content');
      expect(mockTrackEvent).toHaveBeenCalledWith('version:1', 'upload_attachment', 'export');
    });

    it('should update existing attachment when content hash changes', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(htmlToImage.toBlob).mockResolvedValue(mockBlob);
      
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
      
      mockApRequest.mockResolvedValue({ body: 'success' });
      mockConnectRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('new content'); // md5('new content') !== 'hash-old-content'

      expect(md5).toHaveBeenCalledWith('new content');
      expect(mockTrackEvent).toHaveBeenCalledWith('version:3', 'upload_attachment', 'export');
      expect(mockConnectRequest).toHaveBeenCalled(); // updateAttachmentProperties
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
      expect(mockApRequest).not.toHaveBeenCalled();
      expect(mockConnectRequest).not.toHaveBeenCalled();
      // Should not call toPng either
      expect(htmlToImage.toBlob).not.toHaveBeenCalled();
    });

    it('should prevent concurrent execution', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.mocked(htmlToImage.toBlob).mockResolvedValue(mockBlob);
      
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockApRequest.mockResolvedValue({
        body: JSON.stringify({ results: [{ id: 'attachment-123' }] })
      });
      mockConnectRequest.mockResolvedValue({});

      // Set flag to simulate concurrent execution
      (window as any).createAttachmentInProgress = true;

      await createAttachmentIfContentChanged('test content');

      // Should not make any requests
      expect(mockApWrapper._getCurrentPageId).not.toHaveBeenCalled();
      expect(mockApRequest).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockApWrapper._getCurrentPageId.mockRejectedValue(new Error('API error'));

      // The function will throw, but the finally block ensures the flag is reset
      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow('API error');
      // The flag should still be reset in the finally block
      expect((window as any).createAttachmentInProgress).toBe(false);

      consoleErrorSpy.mockRestore();
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
      vi.mocked(htmlToImage.toBlob).mockResolvedValue(mockBlob);
      
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      
      const mockResponse = {
        text: vi.fn().mockResolvedValue(JSON.stringify({ results: [{ id: 'attachment-123' }] }))
      };
      mockRequestConfluence.mockResolvedValue(mockResponse);
      mockForgeRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('test content');

      expect(mockGetContext).toHaveBeenCalled();
      expect(mockRequestConfluence).toHaveBeenCalled();
      expect(mockForgeRequest).toHaveBeenCalled(); // updateAttachmentProperties
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
      mockApRequest.mockResolvedValue({
        body: JSON.stringify({ results: [{ id: 'attachment-123' }] })
      });
      mockConnectRequest.mockResolvedValue({});

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
      vi.mocked(htmlToImage.toBlob).mockResolvedValue(mockBlob);

      const mockElement = document.createElement('div');
      mockElement.className = 'screen-capture-content';
      document.body.appendChild(mockElement);

      // Test through createAttachmentIfContentChanged which calls toPng
      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);
      mockApRequest.mockResolvedValue({
        body: JSON.stringify({ results: [{ id: 'attachment-123' }] })
      });
      mockConnectRequest.mockResolvedValue({});

      await createAttachmentIfContentChanged('test content');

      expect(htmlToImage.toBlob).toHaveBeenCalledWith(mockElement, { backgroundColor: 'white', skipFonts: true });
    });

    it('should handle errors in toPng gracefully', async () => {
      // Remove the iframe so toPng uses html-to-image path
      document.body.innerHTML = '';
      const mockElement = document.createElement('div');
      mockElement.className = 'screen-capture-content';
      document.body.appendChild(mockElement);

      const error = new Error('Conversion failed');
      vi.mocked(htmlToImage.toBlob).mockRejectedValue(error);

      mockApWrapper.getAttachmentsV2.mockResolvedValue([]);

      // toPng is non-async, so the rejection propagates to the caller
      await expect(createAttachmentIfContentChanged('test content')).rejects.toThrow('Conversion failed');

      // The finally block in toPng still runs synchronously
      expect(mockTrackEvent).toHaveBeenCalledWith('toPng', 'convert_to_png', 'export');
      // The flag should still be reset in createAttachmentIfContentChanged's finally block
      expect((window as any).createAttachmentInProgress).toBe(false);
    });
  });

});
