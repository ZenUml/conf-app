import { response, OkResponse } from "../OkResponse";
import { modifyDiagram } from "../service/diagramlyService";
import type { ForgeRequestData } from "../utils/authenticate";
import { resolveDiagramlyIdentity } from "./context";

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: any;
  data: ForgeRequestData;
}) => {
  try {
    const identity = resolveDiagramlyIdentity(data);
    if (identity instanceof Response) {
      return identity;
    }

    const body: {
      diagramCode: string;
      errorMessage: string;
      diagramType: string;
      model?: string;
      disableReasoning?: boolean;
    } = await request.json();

    if (!body.diagramCode) {
      return response(400, "Missing diagramCode");
    }
    if (!body.errorMessage) {
      return response(400, "Missing errorMessage");
    }
    if (body.model !== undefined && typeof body.model !== 'string') {
      return response(400, "model must be a string");
    }
    if (
      body.disableReasoning !== undefined &&
      typeof body.disableReasoning !== 'boolean'
    ) {
      return response(400, "disableReasoning must be a boolean");
    }

    const result = await modifyDiagram(
      { ...identity, env },
      body.diagramCode,
      body.errorMessage,
      body.diagramType,
      {
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(body.disableReasoning !== undefined
          ? { disableReasoning: body.disableReasoning }
          : {}),
      },
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[fix-diagram] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
