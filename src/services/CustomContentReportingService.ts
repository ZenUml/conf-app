import { DiagramType } from "@/model/Diagram/Diagram";
import globals from "@/model/globals";
import { trackEvent } from "@/utils/window";

const yesterday = () => new Date(Date.now() - 86400000);

export async function reportCustomContent() {
  try {
    const customContentReport = await globals.apWrapper.getAppProperty('CustomContentReport');

    if(!customContentReport || new Date(customContentReport.lastUpdated) < yesterday() ) {
      console.debug('start another reporting since the last CustomContentReport:', customContentReport);

      const result = await searchCustomContent();
      console.debug(`reportCustomContent - statistics of custom content:`, result);
      trackEvent(`${JSON.stringify(result)}`, 'reportCustomContent', 'info');

      await globals.apWrapper.setAppProperty('CustomContentReport', {lastUpdated: new Date().toISOString()})
    }
  } catch(e) {
    console.error('Error on reportCustomContent', e);
  }
}

async function searchCustomContent() {
  let total = 0, sequence = 0, graph = 0, openapi = 0, mermaid = 0, unknown = 0;
  const space = (await globals.apWrapper._getCurrentSpace()).key;
  const typesFilter = globals.apWrapper.buildTypesClauseFilter();
  const spacesFilter = `space in (${space})`;
  const searchUrl = `/rest/api/content/search?expand=body.raw&cql=${spacesFilter} and (${typesFilter})`;

  const consumer = (data: any) => {
    total += data?.results?.length;
    data?.results?.forEach((c: any) => {
      try {
        const o = c.body?.raw?.value && JSON.parse(c.body?.raw?.value);
        if(o) {
          o.diagramType === DiagramType.Sequence && sequence++;
          o.diagramType === DiagramType.Graph && graph++;
          o.diagramType === DiagramType.OpenApi && openapi++;
          o.diagramType === DiagramType.Mermaid && mermaid++;
          o.diagramType === DiagramType.Unknown && unknown++;
        }
      } catch(e) {
        unknown++;
      }
    });
  };

  try {
    await globals.apWrapper.requestAllPaginatedData(searchUrl, consumer);
    return {space, total, sequence, graph, openapi, mermaid, unknown};
  } catch (e) {
    console.error('searchCustomContent', e);
  }
}