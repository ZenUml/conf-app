import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MacroMetrics, IMacroMetrics } from './MacroMetrics';
import { DiagramType } from '@/model/Diagram/Diagram';
import { callRemote } from '@/utils/requestUtil';

// Mock getClientDomain
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn(() => 'test-domain')
}));

// Mock callRemote
vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn()
}));

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: false,
  },
}));

describe('MacroMetrics', () => {
  const mockSpace = 'TEST-SPACE';
  const mockDomain = 'test-domain';

  // Mock dependencies
  const mockApWrapper = {
    getCurrentSpace: vi.fn(),
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
      it('should return cached metrics from KV if available', async () => {
        const cachedMetrics: IMacroMetrics = {
          space: mockSpace,
          total: 5,
          sequence: 2,
          graph: 1,
          openapi: 1,
          mermaid: 1,
          unknown: 0,
          isLite: false,
          lastUpdated: new Date().toISOString()
        };

        (callRemote as any).mockResolvedValueOnce(cachedMetrics);

        const result = await macroMetrics.getMacroMetrics();

        expect(result).toEqual(cachedMetrics);
        expect(callRemote).toHaveBeenCalledWith(
          `/metrics-cache/query?domain=${mockDomain}&space=${mockSpace}`,
          'GET'
        );
        expect(mockApWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
      });

      it('should collect new metrics if KV returns null', async () => {
        (callRemote as any).mockResolvedValueOnce(null);
        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        await macroMetrics.getMacroMetrics();

        expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalled();
      });

      it('should collect new metrics if KV read fails', async () => {
        (callRemote as any).mockRejectedValueOnce(new Error('Network error'));
        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        await macroMetrics.getMacroMetrics();

        expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalled();
      });
    });

    describe('content counting', () => {
      it('should correctly count different diagram types', async () => {
        // Mock KV miss to force new collection
        (callRemote as any).mockResolvedValueOnce(null);

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

        const result = await macroMetrics.getMacroMetrics();

        expect(result).toEqual({
          space: mockSpace,
          total: 6,
          sequence: 2,
          graph: 1,
          openapi: 1,
          mermaid: 1,
          plantuml: 0,
          unknown: 1,
          isLite: false
        });
      });

      it('should handle empty results', async () => {
        // Mock KV miss to force new collection
        (callRemote as any).mockResolvedValueOnce(null);

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer({ results: [] });
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics();

        expect(result).toEqual({
          space: mockSpace,
          total: 0,
          sequence: 0,
          graph: 0,
          openapi: 0,
          mermaid: 0,
          plantuml: 0,
          unknown: 0,
          isLite: false
        });
      });
    });

    describe('error handling', () => {
      it('should handle invalid JSON in content', async () => {
        // Mock KV miss to force new collection
        (callRemote as any).mockResolvedValueOnce(null);

        const mockResults = {
          results: [
            { body: { raw: { value: 'invalid json' } } }
          ]
        };

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics();

        expect(result?.unknown).toBe(1);
        expect(mockEventTracker).toHaveBeenCalledWith(
          expect.any(String),
          'report_macro_metrics',
          'error'
        );
      });

      it('should handle missing content values', async () => {
        // Mock KV miss to force new collection
        (callRemote as any).mockResolvedValueOnce(null);

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

        const result = await macroMetrics.getMacroMetrics();

        expect(result?.unknown).toBe(3);
        expect(result?.total).toBe(3);
      });
    });
  });

  describe('reportMacroMetrics', () => {
    it('should collect fresh metrics, write to KV, and track event', async () => {
      mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
        consumer({
          results: [
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } },
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Graph }) } } }
          ]
        });
        return Promise.resolve({});
      });

      (callRemote as any).mockResolvedValueOnce({ success: true });

      await macroMetrics.reportMacroMetrics();

      // Should collect fresh metrics
      expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalled();

      // Should write to KV
      expect(callRemote).toHaveBeenCalledWith(
        '/metrics-cache/update',
        'POST',
        expect.objectContaining({
          domain: mockDomain,
          space: mockSpace,
          metrics: expect.objectContaining({
            total: 2,
            sequence: 1,
            graph: 1
          })
        })
      );

      // Should track event
      expect(mockEventTracker).toHaveBeenCalledWith(
        expect.stringContaining(mockSpace),
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
      // Mock KV miss to force new collection
      (callRemote as any).mockResolvedValueOnce(null);

      mockApWrapper.buildTypesClauseFilter.mockReturnValue('type=customContent');
      mockApWrapper.requestAllPaginatedData.mockResolvedValue({});

      await macroMetrics.getMacroMetrics();

      expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalledWith(
        `/rest/api/content/search?expand=body.raw&cql=space in ("${mockSpace}") and (type=customContent)`,
        expect.any(Function)
      );
    });
  });
});