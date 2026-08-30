import { OkResponse, response } from "../OkResponse";
import { ensureDiagramlyDiagram } from "../service/diagramlyService";
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
      diagramCode?: string;
      diagramType?: string;
      title?: string;
      diagramId?: string;
    } = await request.json();

    if (!body.diagramId && !body.diagramCode?.trim()) {
      return response(400, "Missing diagramCode");
    }
    if (!body.diagramType || body.diagramType === "graph") {
      return response(400, "Unsupported diagramType");
    }

    const result = await ensureDiagramlyDiagram(
      { ...identity, env },
      body.diagramCode,
      body.diagramType,
      body.title,
      body.diagramId,
    );

    return OkResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ensure-diagram] Error:", message);
    return response(500, message || "Internal server error");
  }
};
