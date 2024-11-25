import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reportCustomContent, searchCustomContent } from './CustomContentReportingService';
import { DiagramType } from '@/model/Diagram/Diagram';
import { trackEvent } from '@/utils/window';

// Mock dependencies
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      _getCurrentSpace: vi.fn(),
      getAppProperty: vi.fn(),
      setAppProperty: vi.fn(),
      buildTypesClauseFilter: vi.fn(),
      requestAllPaginatedData: vi.fn(),
      isLite: vi.fn()
    }
  }
}));

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn()
}));

// Import mocks after they're defined
import globals from '@/model/globals';

describe('CustomContentReportingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reportCustomContent', () => {
    it('should not report if last report was recent', async () => {
      // Setup
      const mockSpace = 'TEST-SPACE';
      const today = new Date();
      vi.mocked(globals.apWrapper._getCurrentSpace).mockResolvedValue({ key: mockSpace });
      vi.mocked(globals.apWrapper.getAppProperty).mockResolvedValue({
        lastUpdated: today.toISOString()
      });

      // Execute
      await reportCustomContent();

      // Verify
      expect(globals.apWrapper.setAppProperty).not.toHaveBeenCalled();
    });

    it('should report if last report was old', async () => {
      // Setup
      const mockSpace = 'TEST-SPACE';
      const oldDate = new Date(Date.now() - 90000000); // More than 1 day old
      vi.mocked(globals.apWrapper._getCurrentSpace).mockResolvedValue({ key: mockSpace });
      vi.mocked(globals.apWrapper.getAppProperty).mockResolvedValue({
        lastUpdated: oldDate.toISOString()
      });
      vi.mocked(globals.apWrapper.requestAllPaginatedData).mockResolvedValue({});

      // Execute
      await reportCustomContent();

      // Verify
      expect(globals.apWrapper.setAppProperty).toHaveBeenCalled();
    });
  });

  describe('searchCustomContent', () => {
    it('should correctly count different diagram types', async () => {
      // Setup
      const mockSpace = 'TEST-SPACE';
      const mockResults = {
        results: [
          { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } },
          { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Graph }) } } },
          { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.OpenApi }) } } },
          { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Mermaid }) } } },
          { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Unknown }) } } }
        ]
      };

      vi.mocked(globals.apWrapper.buildTypesClauseFilter).mockReturnValue('type=page');
      vi.mocked(globals.apWrapper.requestAllPaginatedData).mockImplementation((url, consumer) => {
        consumer(mockResults);
        return Promise.resolve({});
      });
      vi.mocked(globals.apWrapper.isLite).mockReturnValue(false);

      // Execute
      const result = await searchCustomContent(mockSpace);

      // Verify
      expect(result).toEqual({
        space: mockSpace,
        total: 5,
        sequence: 1,
        graph: 1,
        openapi: 1,
        mermaid: 1,
        unknown: 1,
        isLite: false
      });
    });

    it('should handle errors in content parsing', async () => {
      // Setup
      const mockSpace = 'TEST-SPACE';
      const mockResults = {
        results: [
          { body: { raw: { value: 'invalid json' } } }
        ]
      };
      vi.mocked(globals.apWrapper.buildTypesClauseFilter).mockReturnValue('type=page');
      vi.mocked(globals.apWrapper.requestAllPaginatedData).mockImplementation((url, consumer) => {
        consumer(mockResults);
        return Promise.resolve();
      });

      // Execute
      const result = await searchCustomContent(mockSpace);
      // Verify
      expect(result!.unknown).toBe(1);
      expect(trackEvent).toHaveBeenCalledWith(
        expect.any(String),
        'reportCustomContent',
        'error'
      );
    });
  });
});