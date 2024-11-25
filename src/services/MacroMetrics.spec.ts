import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MacroMetrics } from './MacroMetrics';
import { DiagramType } from '@/model/Diagram/Diagram';

describe('MacroMetrics', () => {
  const mockSpace = 'TEST-SPACE';
  const propertyKey = 'CustomContentReport_TEST-SPACE';

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
    // @ts-ignore
    macroMetrics = new MacroMetrics(mockApWrapper, mockEventTracker);

    // Default mock implementations
    mockApWrapper.getCurrentSpace.mockResolvedValue({ key: mockSpace });
    mockApWrapper.buildTypesClauseFilter.mockReturnValue('type=page');
    mockApWrapper.isLite.mockReturnValue(false);
  });

  describe('reportCustomContent', () => {
    describe('report timing', () => {
      it('should not report if last report was within 24 hours', async () => {
        const today = new Date();
        mockApWrapper.getAppProperty.mockResolvedValue({
          lastUpdated: today.toISOString()
        });

        await macroMetrics.reportMacroMetrics();

        expect(mockApWrapper.setAppProperty).not.toHaveBeenCalled();
        expect(mockApWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
      });

      it('should report if last report was older than 24 hours', async () => {
        const oldDate = new Date(Date.now() - 90000000); // > 24 hours
        mockApWrapper.getAppProperty.mockResolvedValue({
          lastUpdated: oldDate.toISOString()
        });
        mockApWrapper.requestAllPaginatedData.mockResolvedValue({});

        await macroMetrics.reportMacroMetrics();

        expect(mockApWrapper.setAppProperty).toHaveBeenCalledWith(
          propertyKey,
          expect.objectContaining({
            space: mockSpace,
            lastUpdated: expect.any(String)
          })
        );
      });

      it('should report if no previous report exists', async () => {
        mockApWrapper.getAppProperty.mockResolvedValue(null);
        mockApWrapper.requestAllPaginatedData.mockResolvedValue({});

        await macroMetrics.reportMacroMetrics();

        expect(mockApWrapper.setAppProperty).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle and track errors during reporting', async () => {
        const error = new Error('Test error');
        mockApWrapper.getCurrentSpace.mockRejectedValue(error);

        await macroMetrics.reportMacroMetrics();

        expect(mockEventTracker).toHaveBeenCalledWith(
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

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

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

        mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
          consumer(mockResults);
          return Promise.resolve({});
        });

        const result = await macroMetrics.getMacroMetrics(mockSpace);

        expect(result?.unknown).toBe(3);
        expect(result?.total).toBe(3);
      });
    });

    describe('URL building', () => {
      it('should build correct search URL', async () => {
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
});