import { forgeRequest } from "@/utils/requestUtil";
import type { AdfDoc } from "./macroTemplateAdf";

export const TEMPLATE_DESCRIPTION =
  "Start a page with a ZenUML diagram. Created by ZenUML Lite.";

export type TemplateCreateReason =
  | "forbidden"
  | "bad_request"
  | "network"
  | "unexpected";

export class TemplateCreateError extends Error {
  constructor(
    public readonly reason: TemplateCreateReason,
    message: string,
  ) {
    super(message);
    this.name = "TemplateCreateError";
  }
}

export interface CreateSpaceTemplateOptions {
  spaceKey: string;
  name: string;
  adf: AdfDoc;
}

/** Creates a space template through the current admin's Forge user session. */
export async function createSpaceTemplate(
  opts: CreateSpaceTemplateOptions,
): Promise<{ templateId: string }> {
  let response: any;
  try {
    response = await forgeRequest("/wiki/rest/api/template", "POST", {
      name: opts.name,
      templateType: "page",
      description: TEMPLATE_DESCRIPTION,
      space: { key: opts.spaceKey },
      body: {
        atlas_doc_format: {
          value: JSON.stringify(opts.adf),
          representation: "atlas_doc_format",
        },
      },
    });
  } catch (error) {
    throw new TemplateCreateError(
      "network",
      error instanceof Error ? error.message : "request failed",
    );
  }

  if (typeof response?.statusCode === "number") {
    const reason: TemplateCreateReason =
      response.statusCode === 403
        ? "forbidden"
        : response.statusCode === 400
          ? "bad_request"
          : "unexpected";
    throw new TemplateCreateError(
      reason,
      String(response.message || response.statusCode),
    );
  }

  if (
    response?.templateId === undefined ||
    response?.templateId === null ||
    String(response.templateId).trim() === ""
  ) {
    throw new TemplateCreateError(
      "unexpected",
      "template response did not include a templateId",
    );
  }

  return { templateId: String(response.templateId) };
}
