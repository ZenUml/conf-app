import { response, OkResponse } from "../OkResponse";
export interface Env {
  DB: D1Database;
}
export const onRequest = async ({ request, env }) => {

  if ('GET' === request.method) {
    const { results } = await env.DB.prepare( "SELECT * FROM DiagramLikes" ) .all();
    return Response.json(results);
  }
  else if ('POST' === request.method) {
    const body: any = await request.json();
    console.log('req body:', body);

    const result = await env.DB.prepare( "insert into DiagramLikes (userAccountId, diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId, macroId) VALUES (?1, ?2, ?3, ?4, ?5, ?6)" )
      .bind(body.userAccountId, body.diagramCustomContentId, body.clientDomain, body.confluenceSpace, body.confluencePageId, body.macroId)
      .run();
    console.log('run result:', JSON.stringify(result));
    return new Response("Record created");
  }

  return OkResponse();
};
