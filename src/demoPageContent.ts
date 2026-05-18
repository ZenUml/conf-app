export const DEMO_PAGE_TITLE = 'Welcome to Diagramly — Try it out';

export const MACRO_KEYS = [
  'gpt-diagram-macro',
  'zenuml-graph-macro',
  'zenuml-openapi-macro',
  'zenuml-embed-macro',
] as const;

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const heading = (level: 1 | 2, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

const extension = (
  extensionKey: string,
  bodyType: 'sequence' | 'mermaid' | 'graph' | 'openapi' | 'embed',
  body: string,
) => ({
  type: 'extension',
  attrs: {
    extensionType: 'com.atlassian.confluence.macro.core',
    extensionKey,
    parameters: {
      macroParams: {
        bodyType: { value: bodyType },
      },
      macroMetadata: {
        title: extensionKey,
      },
    },
    text: body,
  },
});

const SEQUENCE_BODY = `A.method() {
  B.process()
  return result
}`;

const MERMAID_BODY = `flowchart LR
  Idea --> Draft
  Draft --> Review
  Review --> Ship`;

const GRAPH_BODY = `<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0" /><mxCell id="1" parent="0" />
  <mxCell id="2" value="Start" style="rounded=1" vertex="1" parent="1">
    <mxGeometry x="40" y="40" width="120" height="40" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`;

const OPENAPI_BODY = `openapi: 3.0.0
info:
  title: Demo API
  version: 0.1.0
paths:
  /hello:
    get:
      summary: Returns a greeting
      responses:
        '200':
          description: OK`;

const EMBED_BODY = `https://app.zenuml.com/`;

export const DEMO_PAGE_ADF = {
  type: 'doc',
  version: 1,
  content: [
    heading(1, 'Welcome 👋'),
    paragraph(
      'This page was created by Diagramly so you can try the four diagram types we support. Edit any macro to play with the source.',
    ),

    heading(2, 'Sequence diagram (ZenUML)'),
    paragraph('Describe how components or actors talk to each other.'),
    extension('gpt-diagram-macro', 'sequence', SEQUENCE_BODY),
    paragraph('Tip: click ✨ Aide on this page to improve any diagram with AI.'),

    heading(2, 'Flowchart (Mermaid)'),
    paragraph('Map a process top-to-bottom or left-to-right.'),
    extension('gpt-diagram-macro', 'mermaid', MERMAID_BODY),

    heading(2, 'Graph (DrawIO)'),
    paragraph('Free-form diagrams powered by DrawIO.'),
    extension('zenuml-graph-macro', 'graph', GRAPH_BODY),

    heading(2, 'OpenAPI / Swagger'),
    paragraph('Render an API spec inline.'),
    extension('zenuml-openapi-macro', 'openapi', OPENAPI_BODY),

    heading(2, 'Embed an existing diagram'),
    paragraph('Embed a diagram from app.zenuml.com or another source.'),
    extension('zenuml-embed-macro', 'embed', EMBED_BODY),

    heading(2, 'Not for you?'),
    paragraph('Delete this page if you would rather not see it — Diagramly will not recreate it.'),
  ],
} as const;
