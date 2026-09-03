import { describe, expect, it } from "vitest";
import { buildMacroTemplateAdf } from "./macroTemplateAdf";

const opts = {
  appId: "8ad26115-211f-4216-971b-0540f606303d",
  environmentId: "env-1",
  environmentType: "STAGING",
  macroKey: "zenuml-sequence-macro-lite",
  heading: "Design note",
  intro: "Keep the diagram current.",
};

describe("buildMacroTemplateAdf", () => {
  it("builds the proven instance-free heading, intro, and macro body", () => {
    const doc = buildMacroTemplateAdf(opts);

    expect(doc.version).toBe(1);
    expect(doc.content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "extension",
    ]);

    const extension = doc.content[2];
    expect(extension).toEqual({
      type: "extension",
      attrs: {
        layout: "default",
        extensionType: "com.atlassian.ecosystem",
        extensionKey:
          "8ad26115-211f-4216-971b-0540f606303d/env-1/static/zenuml-sequence-macro-lite",
        text: "Diagram",
        parameters: {
          layout: "extension",
          forgeEnvironment: "STAGING",
          extensionId:
            "ari:cloud:ecosystem::extension/8ad26115-211f-4216-971b-0540f606303d/env-1/static/zenuml-sequence-macro-lite",
          extensionTitle: "Diagram",
          guestParams: {},
        },
      },
    });
  });

  it("serialises without undefined holes", () => {
    const doc = buildMacroTemplateAdf(opts);

    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
