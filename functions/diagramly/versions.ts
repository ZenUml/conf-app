import { response, OkResponse } from "../OkResponse";
import { getDiagramlyVersions } from "../service/diagramlyService";

export const onRequest = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body: {
      diagramId: string;
      accountId: string;
      teamId?: string;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.diagramId) {
      return response(400, "Missing diagramId");
    }

    const result = await getDiagramlyVersions(
      { accountId: body.accountId, teamId: body.teamId, env },
      body.diagramId
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[versions] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
