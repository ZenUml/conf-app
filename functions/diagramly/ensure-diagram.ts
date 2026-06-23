import { response, OkResponse } from "../OkResponse";
import { ensureDiagramlyDiagram } from "../service/diagramlyService";

export const onRequest = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body: {
      diagramCode: string;
      accountId: string;
      diagramType: string;
      teamId?: string;
      title?: string;
      diagramId?: string;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.diagramCode) {
      return response(400, "Missing diagramCode");
    }
    if (!body.diagramType || body.diagramType === "graph") {
      return response(400, "Unsupported diagramType");
    }

    const result = await ensureDiagramlyDiagram(
      { accountId: body.accountId, teamId: body.teamId, env },
      body.diagramCode,
      body.diagramType,
      body.title,
      body.diagramId
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[ensure-diagram] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
