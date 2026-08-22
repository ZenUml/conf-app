export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}

export interface AdfDoc {
  version: 1;
  type: "doc";
  content: AdfNode[];
}

export interface MacroTemplateAdfOptions {
  appId: string;
  environmentId: string;
  environmentType: string;
  macroKey: string;
  heading: string;
  intro: string;
}

/**
 * Builds the extension node proven by the live template spike. It intentionally
 * carries only routing metadata: Confluence stamps localId per page, while the
 * first macro save creates and binds that page's custom-content record.
 */
export function buildMacroTemplateAdf(
  opts: MacroTemplateAdfOptions,
): AdfDoc {
  const extensionPath = `${opts.appId}/${opts.environmentId}/static/${opts.macroKey}`;

  return {
    version: 1,
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: opts.heading }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: opts.intro }],
      },
      {
        type: "extension",
        attrs: {
          layout: "default",
          extensionType: "com.atlassian.ecosystem",
          extensionKey: extensionPath,
          text: "Diagram",
          parameters: {
            layout: "extension",
            forgeEnvironment: opts.environmentType,
            extensionId: `ari:cloud:ecosystem::extension/${extensionPath}`,
            extensionTitle: "Diagram",
            guestParams: {},
          },
        },
      },
    ],
  };
}
