import { OkResponse, response } from "../OkResponse";
import { modifyDiagramWithCommand } from "../service/diagramlyService";
import type { ForgeRequestData } from "../utils/authenticate";
import { resolveDiagramlyIdentity } from "./context";

const SUPPORTED_DIAGRAM_TYPES = new Set([
  "sequence",
  "mermaid",
  "OpenAPI",
  "openapi",
  "plantuml",
]);

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
      diagramId?: string;
      diagramCode?: string;
      command?: string;
      errorMessage?: string;
      diagramType?: string;
      model?: string;
      disableReasoning?: boolean;
    } = await request.json();

    if (typeof body.diagramId !== "string" || !body.diagramId.trim()) {
      return response(400, "Missing diagramId");
    }
    if (typeof body.diagramCode !== "string" || !body.diagramCode.trim()) {
      return response(400, "Missing diagramCode");
    }
    if (typeof body.command !== "string" || !body.command.trim()) {
      return response(400, "Missing command");
    }
    if (
      typeof body.diagramType !== "string" ||
      !SUPPORTED_DIAGRAM_TYPES.has(body.diagramType)
    ) {
      return response(400, "Unsupported diagramType");
    }
    if (
      body.errorMessage !== undefined &&
      typeof body.errorMessage !== "string"
    ) {
      return response(400, "errorMessage must be a string");
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

    const result = await modifyDiagramWithCommand(
      { ...identity, env },
      {
        diagramId: body.diagramId,
        diagramCode: body.diagramCode,
        command: body.command,
        diagramType: body.diagramType,
        ...(body.errorMessage !== undefined
          ? { errorMessage: body.errorMessage }
          : {}),
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(body.disableReasoning !== undefined
          ? { disableReasoning: body.disableReasoning }
          : {}),
      },
    );

    return OkResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[chat-modify] Error:", message);
    return response(500, message || "Internal server error");
  }
};
