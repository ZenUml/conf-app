import { response, OkResponse } from "../OkResponse";
import { modifyDiagram } from "../service/diagramlyService";

export const onRequest = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body: {
      diagramCode: string;
      errorMessage: string;
      accountId: string;
      diagramType: string;
      teamId: string | undefined;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.diagramCode) {
      return response(400, "Missing diagramCode");
    }
    if (!body.errorMessage) {
      return response(400, "Missing errorMessage");
    }

    const result = await modifyDiagram(
      { accountId: body.accountId, teamId: body.teamId, env },
      body.diagramCode,
      body.errorMessage,
      body.diagramType
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[fix-diagram] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
