import { DiagramType } from "@/model/Diagram/Diagram";
import globals from "@/model/globals";
import { trackEvent } from "@/utils/window";
import ApWrapper2 from "@/model/ApWrapper2";

interface IMacroMetrics {
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
  private readonly ONE_DAY_MS = 86400000;
  private readonly PROPERTY_PREFIX = 'CustomContentReport_';

  constructor(
    private readonly apWrapper: ApWrapper2 = globals.apWrapper,
    private readonly eventTracker = trackEvent
  ) {}

  private getYesterday(): Date {
    return new Date(Date.now() - this.ONE_DAY_MS);
  }

  private getPropertyKey(space: string): string {
    return `${this.PROPERTY_PREFIX}${space}`;
  }

  async reportMacroMetrics(): Promise<void> {
    try {
      const space = (await this.apWrapper.getCurrentSpace()).key;
      const propertyKey = this.getPropertyKey(space);
      const property = await this.apWrapper.getAppProperty(propertyKey);

      let noValidRecord = !property || !property.lastUpdated;
      let recordExpired = new Date(property.lastUpdated) < this.getYesterday();
      if (noValidRecord || recordExpired) {
        console.debug(`Starting new report for space ${space}:`, property);

        const result = await this.getMacroMetrics(space);
        console.debug(`Report macro metrics for space ${space}:`, result);
        this.eventTracker(`${JSON.stringify(result)}`, 'report_macro_metrics', 'info');

        await this.updateAppProperty(space, result);
      }
    } catch (e) {
      console.error('Error on reportCustomContent', e);
      this.trackError(e);
    }
  }

  private async updateAppProperty(space: string, result: IMacroMetrics | undefined): Promise<void> {
    await this.apWrapper.setAppProperty(
      this.getPropertyKey(space),
      {
        ...result,
        lastUpdated: new Date().toISOString()
      }
    );
  }

  async getMacroMetrics(space: string): Promise<IMacroMetrics | undefined> {
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
      console.error('Error on searchCustomContent', e);
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
    this.eventTracker(JSON.stringify(e), 'reportCustomContent', 'error');
  }
}

// Factory function for creating instances
export const createMacroMetrics = () => new MacroMetrics();

// Maintain backward compatibility with existing code
export default  createMacroMetrics();
