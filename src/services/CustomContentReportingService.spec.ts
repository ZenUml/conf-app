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
  const mockSpace = 'TEST-SPACE';
  const propertyKey = 'CustomContentReport_TEST-SPACE';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    vi.mocked(globals.apWrapper._getCurrentSpace).mockResolvedValue({ key: mockSpace });
    vi.mocked(globals.apWrapper.buildTypesClauseFilter).mockReturnValue('type=page');
    vi.mocked(globals.apWrapper.isLite).mockReturnValue(false);
  });

  describe('reportCustomContent', () => {
    describe('report timing', () => {
      it('should not report if last report was within 24 hours', async () => {
        const today = new Date();
        vi.mocked(globals.apWrapper.getAppProperty).mockResolvedValue({
          lastUpdated: today.toISOString()
        });

        await reportCustomContent();

        expect(globals.apWrapper.setAppProperty).not.toHaveBeenCalled();
        expect(globals.apWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
      });

      it('should report if last report was older than 24 hours', async () => {
        const oldDate = new Date(Date.now() - 90000000); // > 24 hours
        vi.mocked(globals.apWrapper.getAppProperty).mockResolvedValue({
          lastUpdated: oldDate.toISOString()
        });
        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockResolvedValue({});

        await reportCustomContent();

        expect(globals.apWrapper.setAppProperty).toHaveBeenCalledWith(
          propertyKey,
          expect.objectContaining({
            space: mockSpace,
            lastUpdated: expect.any(String)
          })
        );
      });

      it('should report if no previous report exists', async () => {
        vi.mocked(globals.apWrapper.getAppProperty).mockResolvedValue(null);
        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockResolvedValue({});

        await reportCustomContent();

        expect(globals.apWrapper.setAppProperty).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle and track errors during reporting', async () => {
        const error = new Error('Test error');
        vi.mocked(globals.apWrapper._getCurrentSpace).mockRejectedValue(error);

        await reportCustomContent();

        expect(trackEvent).toHaveBeenCalledWith(
          JSON.stringify(error),
          'reportCustomContent',
          'error'
        );
      });
    });
  });

  describe('searchCustomContent', () => {
    describe('content counting', () => {
      it('should correctly count different diagram types', async () => {
        const mockResults = {
          results: [
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Graph }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.OpenApi }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Mermaid }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: 'Unknown' }) } } }
          ]
        };

        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await searchCustomContent(mockSpace);

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

      it('should handle empty results', async () => {
        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        const result = await searchCustomContent(mockSpace);

        expect(result).toEqual({
          space: mockSpace,
          total: 0,
          sequence: 0,
          graph: 0,
          openapi: 0,
          mermaid: 0,
          unknown: 0,
          isLite: false
        });
      });
    });

    describe('error handling', () => {
      it('should handle invalid JSON in content', async () => {
        const mockResults = {
          results: [
            { body: { raw: { value: 'invalid json' } } }
          ]
        };

        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await searchCustomContent(mockSpace);

        expect(result.unknown).toBe(1);
        expect(trackEvent).toHaveBeenCalledWith(
          expect.any(String),
          'reportCustomContent',
          'error'
        );
      });

      it('should handle missing content values', async () => {
        const mockResults = {
          results: [
            { body: {} },  // missing raw
            { body: { raw: {} } },  // missing value
            {}  // missing body
          ]
        };

        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockImplementation((url: string, consumer: (data: any) => void) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await searchCustomContent(mockSpace);
        expect(result).toBeDefined();
        expect(result?.unknown).toBe(3);
        expect(result?.total).toBe(3);
      });
    });

    describe('URL building', () => {
      it('should build correct search URL', async () => {
        vi.mocked(globals.apWrapper.buildTypesClauseFilter).mockReturnValue('type=customContent');
        vi.mocked(globals.apWrapper.requestAllPaginatedData).mockResolvedValue({});

        await searchCustomContent(mockSpace);

        expect(globals.apWrapper.requestAllPaginatedData).toHaveBeenCalledWith(
          `/rest/api/content/search?expand=body.raw&cql=space in ("${mockSpace}") and (type=customContent)`,
          expect.any(Function)
        );
      });
    });
  });
});