import { DiagramType } from "@/model/Diagram/Diagram";
import { getDiagramConfig } from "@/model/Diagram/DiagramTypeConfig";
import globals from "@/model/globals";
import { trackEvent, addonKey, serializeError } from "@/utils/window";
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
  asyncapi: number;
  markdown: number;
  unknown: number;
  isLite: boolean;
  lastUpdated?: string;
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

const PAYWALL_COUNT_CEILING = 100;

const EXTRA_METRIC_FIELDS: Partial<Record<DiagramType, keyof IMacroMetrics>> = {
  [DiagramType.AsyncApi]: 'asyncapi',
};

export class MacroMetrics {
  constructor(
    private readonly apWrapper: ApWrapper2 = globals.apWrapper,
    private readonly eventTracker = trackEvent
  ) {}

  async reportMacroMetrics(): Promise<void> {
    try {
      const currentSpace = await this.apWrapper.getCurrentSpace();
      const space = currentSpace.key;
      const domain = getClientDomain();

      const cached = await this.readFromKV(domain, space);
      if (cached?.mode === 'snapshot') {
        console.debug('[metrics:report] snapshot-managed', { space });
        return;
      }

      const metrics = await this.collectMetrics(space, currentSpace.id);

      if (metrics) {
        await this.writeToKV(domain, space, metrics);

        console.debug('[metrics:report] success', { space: metrics.space, total: metrics.total });
        this.eventTracker(`${JSON.stringify(metrics)}`, 'report_macro_metrics', 'info');
      }
    } catch (e) {
      console.warn('[metrics:report] failed', { error: (e as Error).message });
      this.trackError(e);
    }
  }

  async getMacroMetrics(): Promise<IMacroMetrics | undefined> {
    try {
      const currentSpace = await this.apWrapper.getCurrentSpace();
      const space = currentSpace.key;
      const domain = getClientDomain();

      const cached = await this.readFromKV(domain, space);
      if (cached?.metrics) {
        console.debug('[metrics:kv:read] hit', { domain, space });
        return { ...cached.metrics, source: 'kv' };
      }
      if (cached?.mode === 'snapshot') {
        console.warn('[metrics:kv:read] snapshot miss', { domain, space });
        return undefined;
      }

      console.debug('[metrics:kv:read] miss', { domain, space });
      const metrics = await this.collectMetrics(space, currentSpace.id, PAYWALL_COUNT_CEILING);
      if (metrics) {
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

    if (spaceId) {
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
      const searchUrl = this.buildSearchUrl(space);
      await this.apWrapper.requestAllPaginatedData(searchUrl, consumer);
    }

    console.debug('[metrics:collect] success', { space, total: stats.total });
    return {
      space,
      ...stats,
      isLite: this.apWrapper.isLite()
    };
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
      markdown: 0,
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
    if (field && Object.prototype.hasOwnProperty.call(stats, field) && typeof stats[field] === 'number') {
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
      console.warn('[metrics:kv:write] failed', { error: (e as Error).message });
      this.trackError(e);
    }
  }

  private trackError(e: unknown): void {
    const label = e instanceof Error ? `${e.name}: ${e.message}` : serializeError(e);
    this.eventTracker(label, 'report_macro_metrics', 'error');
  }
}

export const createMacroMetrics = () => new MacroMetrics();

export default createMacroMetrics();
