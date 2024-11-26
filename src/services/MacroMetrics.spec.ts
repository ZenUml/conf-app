import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MacroMetrics, IMacroMetrics } from './MacroMetrics';
import { DiagramType } from '@/model/Diagram/Diagram';

describe('MacroMetrics', () => {
  const mockSpace = 'TEST-SPACE';
  const cacheKey = 'MacroMetrics_TEST-SPACE';
// Mock dependencies
  const mockApWrapper = {
    getCurrentSpace: vi.fn(),
    getAppProperty: vi.fn(),
    setAppProperty: vi.fn(),
    buildTypesClauseFilter: vi.fn(),
    requestAllPaginatedData: vi.fn(),
    isLite: vi.fn()
  };

  const mockEventTracker = vi.fn();
  let macroMetrics: MacroMetrics;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create new instance with mocked dependencies
    // @ts-ignore - partial mock implementation
    macroMetrics = new MacroMetrics(mockApWrapper, mockEventTracker);

    // Default mock implementations
    mockApWrapper.getCurrentSpace.mockResolvedValue({ key: mockSpace });
    mockApWrapper.buildTypesClauseFilter.mockReturnValue('type=page');
    mockApWrapper.isLite.mockReturnValue(false);
  });

  describe('getMacroMetrics', () => {
    describe('caching behavior', () => {
      it('should use correct cache key prefix', async () => {
        mockApWrapper.getAppProperty.mockResolvedValue(null);
        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        await macroMetrics.getMacroMetrics(mockSpace);

        expect(mockApWrapper.setAppProperty).toHaveBeenCalledWith(
          cacheKey,
          expect.any(Object)
        );
      });

      it('should return cached metrics if not expired', async () => {
        const cachedMetrics: IMacroMetrics = {
          space: mockSpace,
          total: 5,
          sequence: 2,
          graph: 1,
          openapi: 1,
          mermaid: 1,
          unknown: 0,
          isLite: false
        };

        mockApWrapper.getAppProperty.mockResolvedValue({
          data: cachedMetrics,
          lastUpdated: new Date().toISOString()
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

        expect(result).toEqual(cachedMetrics);
        expect(mockApWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
      });

      it('should collect new metrics if cache is expired', async () => {
        const oldDate = new Date(Date.now() - 90000000); // > 24 hours
        mockApWrapper.getAppProperty.mockResolvedValue({
          data: { space: mockSpace } as IMacroMetrics,
          lastUpdated: oldDate.toISOString()
        });
        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        await macroMetrics.getMacroMetrics(mockSpace);

        expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalled();
        expect(mockApWrapper.setAppProperty).toHaveBeenCalledWith(
          cacheKey,
          expect.objectContaining({
            data: expect.any(Object),
            lastUpdated: expect.any(String)
          })
        );
      });

      it('should collect new metrics if no cache exists', async () => {
        mockApWrapper.getAppProperty.mockResolvedValue(null);
        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        await macroMetrics.getMacroMetrics(mockSpace);

        expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalled();
        expect(mockApWrapper.setAppProperty).toHaveBeenCalled();
      });
    });

    describe('content counting', () => {
      it('should correctly count different diagram types', async () => {
        mockApWrapper.getAppProperty.mockResolvedValue(null); // Force new collection
        const mockResults = {
          results: [
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Graph }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.OpenApi }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Mermaid }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: 'Unknown' }) } } }
          ]
        };

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

        expect(result).toEqual({
          space: mockSpace,
          total: 6,
          sequence: 2,
          graph: 1,
          openapi: 1,
          mermaid: 1,
          unknown: 1,
          isLite: false
        });
      });

      it('should handle empty results', async () => {
        mockApWrapper.getAppProperty.mockResolvedValue(null); // Force new collection
        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

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
        mockApWrapper.getAppProperty.mockResolvedValue(null); // Force new collection
        const mockResults = {
          results: [
            { body: { raw: { value: 'invalid json' } } }
          ]
        };

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

        expect(result?.unknown).toBe(1);
        expect(mockEventTracker).toHaveBeenCalledWith(
          expect.any(String),
          'report_macro_metrics',
          'error'
        );
      });

      it('should handle missing content values', async () => {
        mockApWrapper.getAppProperty.mockResolvedValue(null); // Force new collection
        const mockResults = {
          results: [
            { body: {} },  // missing raw
            { body: { raw: {} } },  // missing value
            {}  // missing body
          ]
        };

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

        expect(result?.unknown).toBe(3);
        expect(result?.total).toBe(3);
      });
    });
  });

  describe('reportMacroMetrics', () => {
    it('should report metrics and track event', async () => {
      const mockMetrics: IMacroMetrics = {
        space: mockSpace,
        total: 5,
        sequence: 2,
        graph: 1,
        openapi: 1,
        mermaid: 1,
        unknown: 0,
        isLite: false
      };

      mockApWrapper.getAppProperty.mockResolvedValue({
        data: mockMetrics,
        lastUpdated: new Date().toISOString()
      });

      await macroMetrics.reportMacroMetrics();

      expect(mockEventTracker).toHaveBeenCalledWith(
        JSON.stringify(mockMetrics),
        'report_macro_metrics',
        'info'
      );
    });

    it('should handle errors during reporting', async () => {
      const error = new Error('Test error');
      mockApWrapper.getCurrentSpace.mockRejectedValue(error);

      await macroMetrics.reportMacroMetrics();

      expect(mockEventTracker).toHaveBeenCalledWith(
        JSON.stringify(error),
        'report_macro_metrics',
        'error'
      );
    });
  });

  describe('URL building', () => {
    it('should build correct search URL', async () => {
      mockApWrapper.getAppProperty.mockResolvedValue(null); // Force new collection
      mockApWrapper.buildTypesClauseFilter.mockReturnValue('type=customContent');
      mockApWrapper.requestAllPaginatedData.mockResolvedValue({});

      await macroMetrics.getMacroMetrics(mockSpace);

      expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalledWith(
        `/rest/api/content/search?expand=body.raw&cql=space in ("${mockSpace}") and (type=customContent)`,
        expect.any(Function)
      );
    });
  });
});