import { response, OkResponse } from "../OkResponse";
import { restoreDiagramlyVersion } from "../service/diagramlyService";

export const onRequest = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body: {
      diagramId: string;
      versionId: string;
      accountId: string;
      teamId?: string;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.diagramId) {
      return response(400, "Missing diagramId");
    }
    if (!body.versionId) {
      return response(400, "Missing versionId");
    }

    const result = await restoreDiagramlyVersion(
      { accountId: body.accountId, teamId: body.teamId, env },
      body.diagramId,
      body.versionId
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[restore-version] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
