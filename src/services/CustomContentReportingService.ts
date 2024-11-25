import { DiagramType } from "@/model/Diagram/Diagram";
import globals from "@/model/globals";
import { trackEvent } from "@/utils/window";

interface ContentReport {
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

class CustomContentReportingService {
  private static readonly ONE_DAY_MS = 86400000;
  private static readonly PROPERTY_PREFIX = 'CustomContentReport_';

  private static yesterday(): Date {
    return new Date(Date.now() - this.ONE_DAY_MS);
  }

  private static getPropertyKey(space: string): string {
    return `${this.PROPERTY_PREFIX}${space}`;
  }

  static async reportCustomContent(): Promise<void> {
    try {
      const space = (await globals.apWrapper._getCurrentSpace()).key;
      const propertyKey = CustomContentReportingService.getPropertyKey(space);
      const property = await globals.apWrapper.getAppProperty(propertyKey);

      if (!property || new Date(property.lastUpdated) < CustomContentReportingService.yesterday()) {
        console.debug(`Starting new report for space ${space}:`, property);

        const result = await this.searchCustomContent(space);
        console.debug(`Report statistics for space ${space}:`, result);
        trackEvent(`${JSON.stringify(result)}`, 'reportCustomContent', 'info');

        await CustomContentReportingService.updateAppProperty(space, result);
      }
    } catch (e) {
      console.error('Error on reportCustomContent', e);
      CustomContentReportingService.trackError(e);
    }
  }

  private static async updateAppProperty(space: string, result: ContentReport | undefined): Promise<void> {
    await globals.apWrapper.setAppProperty(
      this.getPropertyKey(space),
      {
        ...result,
        lastUpdated: new Date().toISOString()
      }
    );
  }

  static async searchCustomContent(space: string): Promise<ContentReport | undefined> {
    const stats = {
      total: 0,
      sequence: 0,
      graph: 0,
      openapi: 0,
      mermaid: 0,
      unknown: 0
    };

    const consumer = (data: { results?: ContentResult[] }) => {
      if (!data?.results?.length) return;

      stats.total += data.results.length;
      data.results.forEach(CustomContentReportingService.processContentResult.bind(this, stats));
    };

    try {
      const searchUrl = CustomContentReportingService.buildSearchUrl(space);
      await globals.apWrapper.requestAllPaginatedData(searchUrl, consumer);

      return {
        space,
        ...stats,
        isLite: globals.apWrapper.isLite()
      };
    } catch (e) {
      console.error('Error on searchCustomContent', e);
      CustomContentReportingService.trackError(e);
    }
  }

  private static processContentResult(stats: Partial<ContentReport>, content: ContentResult): void {
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

      switch (parsedContent.diagramType) {
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
    } catch (e) {
      stats.unknown!++;
      CustomContentReportingService.trackError(e);
    }
  }

  private static buildSearchUrl(space: string): string {
    const typesFilter = globals.apWrapper.buildTypesClauseFilter();
    const spacesFilter = `space in ("${space}")`;
    return `/rest/api/content/search?expand=body.raw&cql=${spacesFilter} and (${typesFilter})`;
  }

  private static trackError(e: unknown): void {
    trackEvent(JSON.stringify(e), 'reportCustomContent', 'error');
  }
}

export const { reportCustomContent, searchCustomContent } = CustomContentReportingService;