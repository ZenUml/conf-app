import { OkResponse } from "../OkResponse";
import { queryLikesFromAllUsers } from "./query";
export interface Env {
  DB: D1Database;
}
export const onRequest = async ({ request, env }) => {

  if ('POST' === request.method) {
    const body: any = await request.json();
    console.log('req body:', body);

    const { results } = await env.DB.prepare( "SELECT count(*) as count FROM DiagramLikes WHERE userAccountId=?1 AND diagramCustomContentId=?2 AND clientDomain=?3 AND confluenceSpace=?4 AND confluencePageId=?5" ).bind(body.userAccountId, body.diagramCustomContentId, body.clientDomain, body.confluenceSpace, body.confluencePageId).all();

    if(results && results[0]?.count > 0) {
      const result = await env.DB.prepare( "DELETE FROM DiagramLikes WHERE userAccountId=?1 AND diagramCustomContentId=?2 AND clientDomain=?3 AND confluenceSpace=?4 AND confluencePageId=?5" ).bind(body.userAccountId, body.diagramCustomContentId, body.clientDomain, body.confluenceSpace, body.confluencePageId).run();
      console.log('run result:', JSON.stringify(result));
    } else {
      const result = await env.DB.prepare( "insert into DiagramLikes (userAccountId, diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId, macroUuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)" )
        .bind(body.userAccountId, body.diagramCustomContentId, body.clientDomain, body.confluenceSpace, body.confluencePageId, body.macroUuid)
        .run();
      console.log('run result:', JSON.stringify(result));
    }

    return await queryLikesFromAllUsers(env, body);
  }

  return OkResponse();
};
