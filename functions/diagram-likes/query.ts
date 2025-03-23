import { OkResponse } from "../OkResponse";
export interface Env {
  DB: D1Database;
}
export const onRequest = async ({ request, env }) => {

  if ('POST' === request.method) {
    const body: any = await request.json();
    console.log('req body:', body);

    const { results } = await env.DB.prepare( "SELECT * FROM DiagramLikes WHERE userAccountId=?1 AND diagramCustomContentId=?2 AND clientDomain=?3 AND confluenceSpace=?4 AND confluencePageId=?5" ).bind(body.userAccountId, body.diagramCustomContentId, body.clientDomain, body.confluenceSpace, body.confluencePageId).all();
    return Response.json(results);
  }

  return OkResponse();
};
