import { DiagramType } from "@/model/Diagram/Diagram";
import globals from "@/model/globals";
import { trackEvent } from "@/utils/window";
import ApWrapper2 from "@/model/ApWrapper2";
import { MetricsCache } from "./MetricsCache";

export interface IMacroMetrics {
  space: string;
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  unknown: number;
  isLite: boolean;
  lastUpdated?: string;
}

interface ContentResult {
  body?: {
    raw?: {
      value?: string;
    };
  };
}

export class MacroMetrics {
  private static readonly CACHE_PREFIX = 'MacroMetrics';
  private readonly cache: MetricsCache<IMacroMetrics>;

  constructor(
    private readonly apWrapper: ApWrapper2 = globals.apWrapper,
    private readonly eventTracker = trackEvent
  ) {
    this.cache = new MetricsCache(apWrapper, MacroMetrics.CACHE_PREFIX);
  }

  // Report Macro Metrics for the Current Space.
  async reportMacroMetrics(): Promise<void> {
    try {
      const metrics = await this.getMacroMetrics();

      if (metrics) {
        console.debug(`Report macro metrics for space ${metrics.space}:`, metrics);
        this.eventTracker(`${JSON.stringify(metrics)}`, 'report_macro_metrics', 'info');
      }
    } catch (e) {
      console.error('Error on reportMacroMetrics', e);
      this.trackError(e);
    }
  }

  // Get Macro Metrics for the Current Space.
  async getMacroMetrics(): Promise<IMacroMetrics | undefined> {
    try {
      const space = (await this.apWrapper.getCurrentSpace()).key;
      const cachedMetrics = await this.cache.get(space);

      if (cachedMetrics) {
        console.debug(`Using cached metrics for space ${space}`);
        return cachedMetrics;
      }

      // Collect and cache new metrics if needed
      const metrics = await this.collectMetrics(space);
      if (metrics) {
        await this.cache.set(space, metrics);
      }
      return metrics;
    } catch (e) {
      console.error('Error on getMacroMetrics', e);
      this.trackError(e);
      return undefined;
    }
  }

  private async collectMetrics(space: string): Promise<IMacroMetrics | undefined> {
    const stats = this.createInitialStats();

    const consumer = (data: { results?: ContentResult[] }) => {
      if (!data?.results?.length) return;

      stats.total += data.results.length;
      data.results.forEach((content) => this.processContentResult(stats, content));
    };

    try {
      const searchUrl = this.buildSearchUrl(space);
      await this.apWrapper.requestAllPaginatedData(searchUrl, consumer);

      return {
        space,
        ...stats,
        isLite: this.apWrapper.isLite()
      };
    } catch (e) {
      console.error('Error on collectMetrics', e);
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
    switch (diagramType) {
      case DiagramType.Sequence:
        stats.sequence!++;
        break;
      case DiagramType.Graph:
        stats.graph!++;
        break;
      case DiagramType.OpenApi:
        stats.openapi!++;
        break;
      case DiagramType.Mermaid:
        stats.mermaid!++;
        break;
      default:
        stats.unknown!++;
    }
  }

  private buildSearchUrl(space: string): string {
    const typesFilter = this.apWrapper.buildTypesClauseFilter();
    const spacesFilter = `space in ("${space}")`;
    return `/rest/api/content/search?expand=body.raw&cql=${spacesFilter} and (${typesFilter})`;
  }

  private trackError(e: unknown): void {
    this.eventTracker(JSON.stringify(e), 'report_macro_metrics', 'error');
  }
}

// Factory function for creating instances
export const createMacroMetrics = () => new MacroMetrics();

// Maintain backward compatibility with existing code
export default createMacroMetrics();