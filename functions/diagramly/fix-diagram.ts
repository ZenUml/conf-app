import { response } from "../OkResponse";
import { modifyDiagram } from "../service/diagramlyService";
import { diagramlyRoute } from "./route";

export const onRequest = diagramlyRoute("fix-diagram", {
  parse: (body: {
    diagramCode: string;
    errorMessage: string;
    diagramType: string;
    model?: string;
    disableReasoning?: boolean;
  }) => {
    if (!body.diagramCode) {
      return response(400, "Missing diagramCode");
    }
    if (!body.errorMessage) {
      return response(400, "Missing errorMessage");
    }
    if (body.model !== undefined && typeof body.model !== "string") {
      return response(400, "model must be a string");
    }
    if (
      body.disableReasoning !== undefined &&
      typeof body.disableReasoning !== "boolean"
    ) {
      return response(400, "disableReasoning must be a boolean");
    }
    return body;
  },
  run: (ctx, body) =>
    modifyDiagram(ctx, body.diagramCode, body.errorMessage, body.diagramType, {
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.disableReasoning !== undefined
        ? { disableReasoning: body.disableReasoning }
        : {}),
    }),
});
