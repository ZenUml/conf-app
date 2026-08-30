import { DiagramType } from "@/model/Diagram/Diagram";
import { getDiagramConfig } from "@/model/Diagram/DiagramTypeConfig";
import globals from "@/model/globals";
import { trackEvent, addonKey } from "@/utils/window";
import ApWrapper2 from "@/model/ApWrapper2";
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters";
import { callRemote } from "@/utils/requestUtil";

export interface IMacroMetrics {
  space: string;
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  plantuml: number;
  // Lite ships the AsyncAPI macro (ADR-0005 Option A). Its own bucket keeps
  // these out of `unknown`, which is the corrupt-content signal.
  asyncapi: number;
  unknown: number;
  isLite: boolean;
  lastUpdated?: string;
  // Where this count was read from: 'kv' = KV cache hit (may be stale-low),
  // 'collect' = fresh space enumeration. Consumed by the paywall gate's
  // `macro_count_source` telemetry (#302). Absent on the mock/localStorage path.
  source?: 'kv' | 'collect';
}

interface ContentResult {
  body?: {
    raw?: {
      value?: string;
    };
  };
}

interface MacroMetricsQueryResult {
  mode: 'legacy' | 'snapshot';
  metrics: IMacroMetrics | null;
}

// The paywall blocks at this many macros (mirrors MACROS_LIMIT in
// useCustomerSuccessService). On the latency-critical read/gate path we stop
// counting once the total crosses it.
const PAYWALL_COUNT_CEILING = 100;

// Diagram types that own a metric bucket but deliberately have no
// DiagramTypeConfig entry. AsyncAPI renders through the Studio iframe /
// @asyncapi/react-component, not the viewerUrl + storeUpdateAction plumbing
// DiagramTypeConfig describes, so giving it a full config would hand it
// capabilities (agent-link writes, the diagram portal, the template gallery)
// that have never been validated for it. It still needs to be counted.
// Typed to `keyof IMacroMetrics`, not `string`: a mistyped field name would
// otherwise compile, and `(stats[field] as number)++` on a key that isn't there
// is `undefined++` → NaN — a silently wrong count, which is the exact defect
// class this bucket exists to prevent.
const EXTRA_METRIC_FIELDS: Partial<Record<DiagramType, keyof IMacroMetrics>> = {
  [DiagramType.AsyncApi]: 'asyncapi',
};

export class MacroMetrics {
  constructor(
    private readonly apWrapper: ApWrapper2 = globals.apWrapper,
    private readonly eventTracker = trackEvent
  ) {}

  // Report Macro Metrics for the Current Space.
  async reportMacroMetrics(): Promise<void> {
    try {
      const currentSpace = await this.apWrapper.getCurrentSpace();
      const space = currentSpace.key;
      const domain = getClientDomain();

      // Snapshot-managed Lite installations have one authoritative backend
      // writer. The save path only performs this lightweight mode check and
      // never enumerates the space or races the scheduled whole-object commit.
      const cached = await this.readFromKV(domain, space);
      if (cached?.mode === 'snapshot') {
        console.debug('[metrics:report] snapshot-managed', { space });
        return;
      }

      // Always collect fresh metrics on save
      const metrics = await this.collectMetrics(space, currentSpace.id);

      if (metrics) {
        // Write to KV for shared cache
        await this.writeToKV(domain, space, metrics);

        // Report to analytics
        console.debug('[metrics:report] success', { space: metrics.space, total: metrics.total });
        this.eventTracker(`${JSON.stringify(metrics)}`, 'report_macro_metrics', 'info');
      }
    } catch (e) {
      console.warn('[metrics:report] failed', { error: (e as Error).message });
      this.trackError(e);
    }
  }

  // Get Macro Metrics for the Current Space.
  async getMacroMetrics(): Promise<IMacroMetrics | undefined> {
    try {
      const currentSpace = await this.apWrapper.getCurrentSpace();
      const space = currentSpace.key;
      const domain = getClientDomain();

      // Read from KV cache
      const cached = await this.readFromKV(domain, space);
      if (cached?.mode === 'snapshot') {
        if (!cached.metrics) {
          console.warn('[metrics:kv:read] snapshot miss', { domain, space });
          return undefined;
        }
        console.debug('[metrics:kv:read] hit', { domain, space });
        return { ...cached.metrics, source: 'kv' };
      }
      if (cached?.metrics) {
        console.debug('[metrics:kv:read] hit', { domain, space });
        return { ...cached.metrics, source: 'kv' };
      }

      // KV miss, collect fresh metrics. This feeds the awaited paywall gate, so
      // bound the count at the limit — see collectMetrics / PAYWALL_COUNT_CEILING.
      console.debug('[metrics:kv:read] miss', { domain, space });
      const metrics = await this.collectMetrics(space, currentSpace.id, PAYWALL_COUNT_CEILING);
      if (metrics) {
        // Write to cache for future reads
        await this.writeToKV(domain, space, metrics);
        return { ...metrics, source: 'collect' };
      }
      return metrics;
    } catch (e) {
      console.warn('[metrics:kv:read] failed', { error: (e as Error).message });
      this.trackError(e);
      return undefined;
    }
  }

  private async collectMetrics(space: string, spaceId?: string, ceiling?: number): Promise<IMacroMetrics | undefined> {
    const stats = this.createInitialStats();

    const consumer = (data: { results?: ContentResult[] }) => {
      if (!data?.results?.length) return;

      stats.total += data.results.length;
      data.results.forEach((content) => this.processContentResult(stats, content));
    };

    try {
      if (spaceId) {
        // Count from the V2 space custom-content endpoint (system of record),
        // paginated per content type. The v1 CQL content search is
        // search-index-backed and under-returns for large / bulk-grown spaces,
        // which silently under-counted the macro total used by the paywall.
        //
        // When `ceiling` is set (latency-critical read/gate path) stop as soon
        // as the total crosses it — the paywall decision can't change above the
        // limit, so a huge space must not stall the awaited editor/fullscreen
        // mount enumerating thousands of items. The save path passes no ceiling
        // and enumerates fully so the cached/analytics count stays accurate.
        for (const type of this.apWrapper.getMacroContentTypes()) {
          const url = `/api/v2/spaces/${spaceId}/custom-content?type=${encodeURIComponent(type)}&body-format=raw&limit=250`;
          if (ceiling != null) {
            await this.apWrapper.requestPaginatedDataUntil(url, consumer, () => stats.total >= ceiling);
            if (stats.total >= ceiling) break;
          } else {
            await this.apWrapper.requestAllPaginatedData(url, consumer);
          }
        }
      } else {
        // Fallback when no numeric space id is available (e.g. non-Forge
        // contexts where getCurrentSpace() yields only a key).
        const searchUrl = this.buildSearchUrl(space);
        await this.apWrapper.requestAllPaginatedData(searchUrl, consumer);
      }

      console.debug('[metrics:collect] success', { space, total: stats.total });
      return {
        space,
        ...stats,
        isLite: this.apWrapper.isLite()
      };
    } catch (e) {
      console.warn('[metrics:collect] failed', { space, error: (e as Error).message });
      this.trackError(e);
    }
  }

  private createInitialStats(): Omit<IMacroMetrics, 'space' | 'isLite' | 'lastUpdated'> {
    return {
      total: 0,
      sequence: 0,
      graph: 0,
      openapi: 0,
      mermaid: 0,
      plantuml: 0,
      asyncapi: 0,
      unknown: 0
    };
  }

  private processContentResult(stats: Partial<IMacroMetrics>, content: ContentResult): void {
    try {
      const rawValue = content.body?.raw?.value;
      if (!rawValue) {
        stats.unknown!++;
        return;
      }

      const parsedContent = JSON.parse(rawValue);
      if (!parsedContent) {
        stats.unknown!++;
        return;
      }

      this.updateDiagramStats(stats, parsedContent.diagramType);
    } catch (e) {
      stats.unknown!++;
      this.trackError(e);
    }
  }

  private updateDiagramStats(stats: Partial<IMacroMetrics>, diagramType: DiagramType): void {
    const field = (getDiagramConfig(diagramType)?.metricField as keyof IMacroMetrics | undefined)
      ?? EXTRA_METRIC_FIELDS[diagramType];
    if (field) {
      (stats[field] as number)++;
    } else {
      stats.unknown!++;
    }
  }

  private buildSearchUrl(space: string): string {
    const typesFilter = this.apWrapper.buildTypesClauseFilter();
    const spacesFilter = `space in ("${space}")`;
    return `/rest/api/content/search?expand=body.raw&cql=${spacesFilter} and (${typesFilter})`;
  }

  private async readFromKV(domain: string, space: string): Promise<MacroMetricsQueryResult | null> {
    try {
      const response = await callRemote(
        `/metrics-cache/query?contract=2&domain=${encodeURIComponent(domain)}&space=${encodeURIComponent(space)}&addonKey=${encodeURIComponent(addonKey())}`,
        'GET'
      );
      if (
        response
        && (response.mode === 'legacy' || response.mode === 'snapshot')
        && Object.prototype.hasOwnProperty.call(response, 'metrics')
      ) {
        return response as MacroMetricsQueryResult;
      }
      // Defensive compatibility with a backend that has not deployed
      // contract=2 yet: treat the old bare object as a legacy cache hit.
      return response ? { mode: 'legacy', metrics: response as IMacroMetrics } : null;
    } catch (e) {
      console.warn('[metrics:kv:read] failed', { error: (e as Error).message });
      return null;
    }
  }

  private async writeToKV(domain: string, space: string, metrics: IMacroMetrics): Promise<void> {
    try {
      await callRemote(
        `/metrics-cache/update?addonKey=${encodeURIComponent(addonKey())}`,
        'POST',
        { domain, space, metrics }
      );
    } catch (e) {
      // Surface write failures — a silently-swallowed failure left stale-low
      // counts cached with no signal, producing phantom sub-threshold readings.
      console.warn('[metrics:kv:write] failed', { error: (e as Error).message });
      this.trackError(e);
    }
  }

  private trackError(e: unknown): void {
    this.eventTracker(JSON.stringify(e), 'report_macro_metrics', 'error');
  }
}

// Factory function for creating instances
export const createMacroMetrics = () => new MacroMetrics();

// Maintain backward compatibility with existing code
export default createMacroMetrics();
