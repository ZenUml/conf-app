import { OkResponse } from "../OkResponse";
export interface Env {
  DB: D1Database;
}
export const onRequest = async ({ request, env }) => {

  if ('POST' === request.method) {
    const body: any = await request.json();
    console.log('req body:', body);

    return await queryLikesFromAllUsers(env, body);
  }

  return OkResponse();
};

export async function queryLikesFromAllUsers(env, body) {
  try {
    // For new diagrams with no macroUuid or diagramCustomContentId, return empty results immediately
    if (!body.macroUuid || !body.diagramCustomContentId) {
      console.log('New diagram detected (missing macroUuid or diagramCustomContentId). Returning empty likes array.');
      return Response.json([]);
    }

    // Ensure all parameters have default values if undefined
    const diagramCustomContentId = body.diagramCustomContentId;
    const clientDomain = body.clientDomain || '';
    const confluenceSpace = body.confluenceSpace || '';
    const confluencePageId = body.confluencePageId || '';
    const macroUuid = body.macroUuid;

    const { results } = await env.DB.prepare(
      "SELECT * FROM DiagramLikes WHERE diagramCustomContentId=?1 AND clientDomain=?2 AND confluenceSpace=?3 AND confluencePageId=?4 AND macroUuid=?5"
    ).bind(diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId, macroUuid).all();

    return Response.json(results);
  } catch (error) {
    console.error('Error querying diagram likes:', error);
    return Response.json({ error: 'Failed to query diagram likes', details: error.message }, { status: 500 });
  }
}

export async function queryUserLikesInDomain(env, body) {
  const { results } = await env.DB.prepare( "SELECT * FROM DiagramLikes WHERE clientDomain=?1 AND userAccountId=?2" ).bind(body.clientDomain, body.userAccountId).all();
  return Response.json(results);
}
