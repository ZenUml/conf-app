import globals from "@/model/globals";
import { trackEvent } from "@/utils/window";

const yesterday = () => new Date(Date.now() - 86400000);

export async function reportCustomContent() {
  try {
    const customContentReport = await globals.apWrapper.getAppProperty('CustomContentReport');

    if(!customContentReport || new Date(customContentReport.lastUpdated) < yesterday() ) {
      console.debug('start another reporting since the last CustomContentReport:', customContentReport);

      const result = await searchCustomContent();
      console.debug(`reportCustomContent - total count of custom content:`, result);
      trackEvent(`${JSON.stringify(result)}`, 'reportCustomContent', 'info');

      await globals.apWrapper.setAppProperty('CustomContentReport', {lastUpdated: new Date().toISOString()})
    }
  } catch(e) {
    console.error('Error on reportCustomContent', e);
  }
}

async function searchCustomContent() {
  let total = 0, sequence = 0, graph = 0;
  const typesFilter = globals.apWrapper.buildTypesClauseFilter();
  //TODO: Is there a limit of the items in the `in` clause?
  const spacesFilter = `space in (${(await getAllSpaces()).map((s: any) => '"' + s.key + '"').join(',')})`;
  const searchUrl = `/rest/api/content/search?cql=${spacesFilter} and (${typesFilter})`;

  const consumer = (data: any) => {
    total += data?.results?.length;
    sequence += data?.results?.filter((c: any) => c.type.endsWith('zenuml-content-sequence')).length;
    graph += data?.results?.filter((c: any) => c.type.endsWith('zenuml-content-graph')).length;
  };

  try {
    await globals.apWrapper.requestAllPaginatedData(searchUrl, consumer);
    return {total, 'zenuml-content-sequence': sequence, 'zenuml-content-graph': graph};
  } catch (e) {
    console.error('searchCustomContent', e);
  }
}

async function getAllSpaces() {
  let spaces = [];
  const consumer = (data: any) => spaces = spaces.concat(data?.results || []);
  await globals.apWrapper.requestAllPaginatedData(`/api/v2/spaces?limit=2`, consumer);
  return spaces;
}