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

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  addonKey: vi.fn(() => 'com.zenuml.confluence-addon-lite')
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
    requestPaginatedDataUntil: vi.fn(),
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
          plantuml: 0,
          asyncapi: 0,
          unknown: 0,
          isLite: false,
          lastUpdated: new Date().toISOString()
        };

        (callRemote as any).mockResolvedValueOnce(cachedMetrics);

        const result = await macroMetrics.getMacroMetrics();

        // getMacroMetrics tags KV hits with source:'kv' for the paywall gate's
        // macro_count_source telemetry (#302).
        expect(result).toEqual({ ...cachedMetrics, source: 'kv' });
        expect(callRemote).toHaveBeenCalledWith(
          `/metrics-cache/query?contract=2&domain=${mockDomain}&space=${mockSpace}&addonKey=com.zenuml.confluence-addon-lite`,
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

      it('does not collect when a snapshot-managed space is absent from KV', async () => {
        (callRemote as any).mockResolvedValueOnce({ mode: 'snapshot', metrics: null });

        const result = await macroMetrics.getMacroMetrics();

        expect(result).toBeUndefined();
        expect(mockApWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
        expect(mockApWrapper.requestPaginatedDataUntil).not.toHaveBeenCalled();
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
            // Lite ships the AsyncAPI macro under the shared
            // zenuml-content-sequence type (ADR-0005 Option A) — it must land
            // in its own bucket, not in `unknown` alongside corrupt bodies.
            { body: { raw: { value: JSON.stringify({ diagramType: DiagramType.AsyncApi }) } } },
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
          total: 7,
          sequence: 2,
          graph: 1,
          openapi: 1,
          mermaid: 1,
          plantuml: 0,
          asyncapi: 1,
          unknown: 1,
          isLite: false,
          source: 'collect'
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
          asyncapi: 0,
          unknown: 0,
          isLite: false,
          source: 'collect'
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
    it('does not enumerate or write in snapshot-managed mode', async () => {
      (callRemote as any).mockResolvedValueOnce({ mode: 'snapshot', metrics: null });

      await macroMetrics.reportMacroMetrics();

      expect(mockApWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
      expect(mockApWrapper.requestPaginatedDataUntil).not.toHaveBeenCalled();
      expect(callRemote).toHaveBeenCalledTimes(1);
    });

    it('should collect metrics in Forge mode', async () => {
      const forgeGlobal = await import('@/model/globals/forgeGlobal');
      (forgeGlobal.default as any).isForge = true;

      mockApWrapper.requestAllPaginatedData.mockImplementation((url, consumer) => {
        consumer({ results: [] });
        return Promise.resolve({});
      });
      (callRemote as any).mockResolvedValueOnce({ success: true });

      await macroMetrics.reportMacroMetrics();

      expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalled();

      (forgeGlobal.default as any).isForge = false;
    });

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
        '/metrics-cache/update?addonKey=com.zenuml.confluence-addon-lite',
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

  describe('structured logging', () => {
    let debugSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should log [metrics:kv:read] hit on cache hit', async () => {
      const cachedMetrics: IMacroMetrics = {
        space: mockSpace, total: 5, sequence: 2, graph: 1,
        openapi: 1, mermaid: 1, plantuml: 0, asyncapi: 0, unknown: 0,
        isLite: false, lastUpdated: new Date().toISOString()
      };
      (callRemote as any).mockResolvedValueOnce(cachedMetrics);

      await macroMetrics.getMacroMetrics();

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:kv:read] hit'),
        expect.objectContaining({ space: mockSpace })
      );
    });

    it('should log [metrics:kv:read] miss on cache miss', async () => {
      (callRemote as any).mockResolvedValueOnce(null);
      mockApWrapper.requestAllPaginatedData.mockImplementation((_url: string, consumer: Function) => {
        consumer({ results: [] });
        return Promise.resolve({});
      });

      await macroMetrics.getMacroMetrics();

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:kv:read] miss'),
        expect.objectContaining({ space: mockSpace })
      );
    });

    it('should log [metrics:kv:read] failed on cache error', async () => {
      (callRemote as any).mockRejectedValueOnce(new Error('Network error'));
      mockApWrapper.requestAllPaginatedData.mockImplementation((_url: string, consumer: Function) => {
        consumer({ results: [] });
        return Promise.resolve({});
      });

      await macroMetrics.getMacroMetrics();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:kv:read] failed'),
        expect.objectContaining({ error: 'Network error' })
      );
    });

    it('should log [metrics:collect] success with total count', async () => {
      (callRemote as any).mockResolvedValueOnce(null);
      mockApWrapper.requestAllPaginatedData.mockImplementation((_url: string, consumer: Function) => {
        consumer({ results: [
          { body: { raw: { value: JSON.stringify({ diagramType: 'Sequence' }) } } },
        ]});
        return Promise.resolve({});
      });

      await macroMetrics.getMacroMetrics();

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics:collect] success'),
        expect.objectContaining({ total: 1 })
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

  // Large/bulk-grown spaces were under-counted because the v1 CQL content
  // search is search-index-backed and returns incomplete results. When a
  // numeric space id is available (Forge), count from the V2 space
  // custom-content endpoint (system of record), paginated per type.
  describe('collectMetrics via V2 space custom-content (large-space safe)', () => {
    beforeEach(() => {
      mockApWrapper.getCurrentSpace.mockResolvedValue({ key: mockSpace, id: 'space-789' });
      (mockApWrapper as any).getMacroContentTypes = vi.fn().mockReturnValue(['T-seq', 'T-graph']);
    });

    // Read/gate path (getMacroMetrics feeds the awaited paywall gate, so it is
    // latency-critical): early-exit once the count crosses the limit — a huge
    // space must not stall the editor/fullscreen gate enumerating thousands.
    it('early-exits at the macro limit on the read/gate path (does not enumerate the whole space)', async () => {
      (callRemote as any).mockResolvedValueOnce(null); // KV miss → collect fresh

      mockApWrapper.requestPaginatedDataUntil.mockImplementation(
        async (url: string, consumer: (d: any) => void, shouldStop: () => boolean) => {
          const pagesByType: Record<string, any[][]> = {
            'T-seq': [
              new Array(250).fill({ body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } }),
              new Array(150).fill({ body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Mermaid }) } } }),
            ],
            'T-graph': [new Array(60).fill({ body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Graph }) } } })],
          };
          for (const page of pagesByType[url.includes('type=T-seq') ? 'T-seq' : 'T-graph']) {
            consumer({ results: page });
            if (shouldStop()) return;
          }
        }
      );

      const result = await macroMetrics.getMacroMetrics();

      // first page (250) already crosses the 100 limit → stop: never fetch the
      // second T-seq page, never query the T-graph type, never touch v1 CQL.
      expect(mockApWrapper.requestPaginatedDataUntil).toHaveBeenCalledTimes(1);
      expect(mockApWrapper.requestPaginatedDataUntil.mock.calls[0][0]).toContain('/api/v2/spaces/space-789/custom-content');
      expect(mockApWrapper.requestPaginatedDataUntil.mock.calls[0][0]).toContain('type=T-seq');
      expect(mockApWrapper.requestAllPaginatedData).not.toHaveBeenCalled();
      expect(result?.total).toBe(250);
      expect(result?.sequence).toBe(250);
      expect(result?.graph).toBe(0);
    });

    // Save path (reportMacroMetrics is fire-and-forget, not latency-critical):
    // enumerate the whole space so the cached/analytics count stays accurate.
    it('counts the full space on the save path (no early-exit) so KV/analytics stay accurate', async () => {
      mockApWrapper.requestAllPaginatedData.mockImplementation((url: string, consumer: Function) => {
        if (url.includes('type=T-seq')) {
          consumer({ results: new Array(250).fill({ body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Sequence }) } } }) });
          consumer({ results: new Array(150).fill({ body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Mermaid }) } } }) });
        } else if (url.includes('type=T-graph')) {
          consumer({ results: new Array(60).fill({ body: { raw: { value: JSON.stringify({ diagramType: DiagramType.Graph }) } } }) });
        }
        return Promise.resolve({});
      });
      (callRemote as any).mockResolvedValueOnce({ success: true }); // KV write

      await macroMetrics.reportMacroMetrics();

      // full enumeration of both types via the unbounded paginator; no early-exit
      expect(mockApWrapper.requestAllPaginatedData).toHaveBeenCalledTimes(2);
      expect(mockApWrapper.requestPaginatedDataUntil).not.toHaveBeenCalled();
      const urls = mockApWrapper.requestAllPaginatedData.mock.calls.map((c: any[]) => c[0] as string);
      expect(urls.every((u) => u.includes('/api/v2/spaces/space-789/custom-content'))).toBe(true);
      expect(callRemote).toHaveBeenCalledWith(
        '/metrics-cache/update?addonKey=com.zenuml.confluence-addon-lite',
        'POST',
        expect.objectContaining({ metrics: expect.objectContaining({ total: 460, sequence: 250, mermaid: 150, graph: 60 }) })
      );
    });

    it('falls back to the v1 CQL search when no numeric space id is available', async () => {
      mockApWrapper.getCurrentSpace.mockResolvedValue({ key: mockSpace }); // no id
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

  // A silent (swallowed) KV write failure left stale-low counts cached with no
  // signal. Write failures must be surfaced via the error tracker.
  describe('KV write failure surfacing', () => {
    it('surfaces a KV write failure instead of swallowing it', async () => {
      mockApWrapper.requestAllPaginatedData.mockImplementation((_url: string, consumer: Function) => {
        consumer({ results: [] });
        return Promise.resolve({});
      });
      // mode check succeeds, then the KV update POST rejects
      (callRemote as any)
        .mockResolvedValueOnce({ mode: 'legacy', metrics: null })
        .mockRejectedValueOnce(new Error('KV write failed'));

      await macroMetrics.reportMacroMetrics();

      expect(mockEventTracker).toHaveBeenCalledWith(
        expect.any(String),
        'report_macro_metrics',
        'error'
      );
    });
  });
});
