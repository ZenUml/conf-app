import { response, OkResponse } from "../OkResponse";
import { modifyDiagramWithCommand } from "../service/diagramlyService";

export const onRequest = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body: {
      diagramCode: string;
      command: string;
      errorMessage?: string;
      accountId: string;
      diagramType: string;
      teamId?: string;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.diagramCode) {
      return response(400, "Missing diagramCode");
    }
    if (!body.command) {
      return response(400, "Missing command");
    }
    if (!body.diagramType || body.diagramType === "graph") {
      return response(400, "Unsupported diagramType");
    }

    const result = await modifyDiagramWithCommand(
      { accountId: body.accountId, teamId: body.teamId, env },
      body.diagramCode,
      body.command,
      body.errorMessage,
      body.diagramType
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[chat-modify] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
