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
  const { results } = await env.DB.prepare( "SELECT * FROM DiagramLikes WHERE diagramCustomContentId=?1 AND clientDomain=?2 AND confluenceSpace=?3 AND confluencePageId=?4 AND macroUuid=?5" ).bind(body.diagramCustomContentId, body.clientDomain, body.confluenceSpace, body.confluencePageId, body.macroUuid).all();
  return Response.json(results);
}