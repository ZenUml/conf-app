import { response } from "../OkResponse";
import { ensureDiagramlyDiagram } from "../service/diagramlyService";
import { diagramlyRoute } from "./route";

export const onRequest = diagramlyRoute("ensure-diagram", {
  parse: (body: {
    diagramCode?: string;
    diagramType?: string;
    title?: string;
    diagramId?: string;
  }) => {
    if (!body.diagramId && !body.diagramCode?.trim()) {
      return response(400, "Missing diagramCode");
    }
    if (!body.diagramType || body.diagramType === "graph") {
      return response(400, "Unsupported diagramType");
    }
    return { ...body, diagramType: body.diagramType };
  },
  run: (ctx, body) =>
    ensureDiagramlyDiagram(
      ctx,
      body.diagramCode,
      body.diagramType,
      body.title,
      body.diagramId,
    ),
});
