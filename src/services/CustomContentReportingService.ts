import { DiagramType } from "@/model/Diagram/Diagram";
import globals from "@/model/globals";
import { trackEvent } from "@/utils/window";

const yesterday = () => new Date(Date.now() - 86400000);

export async function reportCustomContent() {
  try {
    const space = (await globals.apWrapper._getCurrentSpace()).key;
    let property = await globals.apWrapper.getAppProperty('CustomContentReport');

    if(!property || !property[space] || new Date(property[space].lastUpdated) < yesterday() ) {
      console.debug(`start another reporting since the last CustomContentReport in space ${space}:`, property);

      const result = await searchCustomContent(space);
      console.debug(`reportCustomContent - statistics of custom content in space ${space}:`, result);
      trackEvent(`${JSON.stringify(result)}`, 'reportCustomContent', 'info');

      await updateAppProperty(property, space);
    }
  } catch(e) {
    console.error('Error on reportCustomContent', e);
    trackError(e);
  }
}

async function updateAppProperty(property: any, space: string) {
  const p = Object.assign({}, property);
  p.lastUpdated = new Date().toISOString();
  p[space] = p.lastUpdated;
  await globals.apWrapper.setAppProperty('CustomContentReport', p);
}

async function searchCustomContent(space: string) {
  let total = 0, sequence = 0, graph = 0, openapi = 0, mermaid = 0, unknown = 0;
  const typesFilter = globals.apWrapper.buildTypesClauseFilter();
  const spacesFilter = `space in ("${space}")`;
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
          
          (!o.diagramType || o.diagramType === DiagramType.Unknown) && unknown++;
        }
      } catch(e) {
        unknown++;
        trackError(e);
      }
    });
  };

  try {
    await globals.apWrapper.requestAllPaginatedData(searchUrl, consumer);
    return {space, total, sequence, graph, openapi, mermaid, unknown};
  } catch (e) {
    console.error('Error on searchCustomContent', e);
    trackError(e);
  }
}

function trackError(e: any) {
  trackEvent(JSON.stringify(e), 'reportCustomContent', 'error');
}