import { OkResponse } from "../OkResponse";
import { queryLikesFromAllUsers } from "./query";
export interface Env {
  DB: D1Database;
}
export const onRequest = async ({ request, env }) => {

  if ('POST' === request.method) {
    try {
      const body: any = await request.json();
      console.log('req body:', body);

      // Check if this is a new diagram (missing macroUuid)
      const isNewDiagram = !body.macroUuid;
      if (isNewDiagram) {
        console.log('New diagram detected (missing macroUuid). Returning empty likes array.');
        return Response.json([]);
      }

      // Ensure we have the required fields
      if (!body.diagramCustomContentId || !body.userAccountId) {
        console.log('Missing required parameters for diagram like operation');
        return Response.json({
          error: 'Missing required parameters',
          details: 'diagramCustomContentId and userAccountId are required'
        }, { status: 400 });
      }

      // Ensure all parameters have default values if undefined
      const userAccountId = body.userAccountId;
      const diagramCustomContentId = body.diagramCustomContentId;
      const clientDomain = body.clientDomain || '';
      const confluenceSpace = body.confluenceSpace || '';
      const confluencePageId = body.confluencePageId || '';
      const macroUuid = body.macroUuid;  // We've already checked this isn't missing

      // Check if the like exists
      const { results } = await env.DB.prepare(
        "SELECT count(*) as count FROM DiagramLikes WHERE userAccountId=?1 AND diagramCustomContentId=?2 AND clientDomain=?3 AND confluenceSpace=?4 AND confluencePageId=?5"
      ).bind(userAccountId, diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId).all();

      if(results && results[0]?.count > 0) {
        // Delete the like
        const result = await env.DB.prepare(
          "DELETE FROM DiagramLikes WHERE userAccountId=?1 AND diagramCustomContentId=?2 AND clientDomain=?3 AND confluenceSpace=?4 AND confluencePageId=?5"
        ).bind(userAccountId, diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId).run();
        console.log('Delete result:', JSON.stringify(result));
      } else {
        // Insert the like
        const result = await env.DB.prepare(
          "INSERT INTO DiagramLikes (userAccountId, diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId, macroUuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        ).bind(userAccountId, diagramCustomContentId, clientDomain, confluenceSpace, confluencePageId, macroUuid).run();
        console.log('Insert result:', JSON.stringify(result));
      }

      return await queryLikesFromAllUsers(env, body);
    } catch (error) {
      console.error('Error toggling diagram like:', error);
      return Response.json({ error: 'Failed to toggle diagram like', details: error.message }, { status: 500 });
    }
  }

  return OkResponse();
};
