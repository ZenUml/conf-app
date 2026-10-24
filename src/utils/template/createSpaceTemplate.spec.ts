import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgeRequest } from "@/utils/requestUtil";
import {
  createSpaceTemplate,
  TemplateCreateError,
} from "./createSpaceTemplate";

vi.mock("@/utils/requestUtil", () => ({ forgeRequest: vi.fn() }));

const adf = { version: 1 as const, type: "doc" as const, content: [] };

beforeEach(() => {
  vi.mocked(forgeRequest).mockReset();
});

describe("createSpaceTemplate", () => {
  it("posts an ADF page template scoped to the requested space", async () => {
    vi.mocked(forgeRequest).mockResolvedValue({ templateId: "99" });

    await expect(
      createSpaceTemplate({ spaceKey: "ENG", name: "Diagram page", adf }),
    ).resolves.toEqual({ templateId: "99" });

    expect(forgeRequest).toHaveBeenCalledWith(
      "/wiki/rest/api/template",
      "POST",
      {
        name: "Diagram page",
        templateType: "page",
        description:
          "Start a page with a ZenUML diagram. Created by ZenUML Lite.",
        space: { key: "ENG" },
        body: {
          atlas_doc_format: {
            value: JSON.stringify(adf),
            representation: "atlas_doc_format",
          },
        },
      },
    );
  });

  it("maps a 403 response body to a forbidden error", async () => {
    vi.mocked(forgeRequest).mockResolvedValue({
      statusCode: 403,
      message: "no permission",
    });

    await expect(
      createSpaceTemplate({ spaceKey: "ENG", name: "Diagram page", adf }),
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("maps a 400 response body to a bad-request error", async () => {
    vi.mocked(forgeRequest).mockResolvedValue({
      statusCode: 400,
      message: "invalid body",
    });

    await expect(
      createSpaceTemplate({ spaceKey: "ENG", name: "Diagram page", adf }),
    ).rejects.toMatchObject({ reason: "bad_request" });
  });

  it("maps a thrown transport failure to a network error", async () => {
    vi.mocked(forgeRequest).mockRejectedValue(new Error("Failed to fetch"));

    const error = await createSpaceTemplate({
      spaceKey: "ENG",
      name: "Diagram page",
      adf,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(TemplateCreateError);
    expect(error).toMatchObject({ reason: "network" });
  });

  it("rejects a response without a template id", async () => {
    vi.mocked(forgeRequest).mockResolvedValue({});

    await expect(
      createSpaceTemplate({ spaceKey: "ENG", name: "Diagram page", adf }),
    ).rejects.toMatchObject({ reason: "unexpected" });
  });
});
