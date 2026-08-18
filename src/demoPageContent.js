// Variant-aware content: this file originally shipped Diagramly-only, with
// its custom-content type and copy hardcoded. It now ships to Lite and Full
// too (Get Started page, task 7), so every variant-specific value is read
// from the Forge manifest's `environment.variables` — exposed to the
// function runtime as `process.env.*`, same mechanism src/page-capture.js
// already uses for BACKEND_API_BASE_URL/PAGE_CAPTURE_SECRET. Each falls back
// to its original Diagramly value when unset (e.g. under `vitest --run`,
// which has no Forge deploy env), so existing behavior for that variant is
// unchanged.
const LITE_KEY_SUFFIX = process.env.LITE_KEY_SUFFIX || '';
const SEQUENCE_MACRO_KEY = process.env.SEQUENCE_MACRO_KEY || 'gpt-diagram-macro';
const GRAPH_MACRO_KEY = `zenuml-graph-macro${LITE_KEY_SUFFIX}`;
const OPENAPI_MACRO_KEY = `zenuml-openapi-macro${LITE_KEY_SUFFIX}`;

// The variant's own display name (manifest APP_LABEL — e.g. "ZenUML for
// Confluence Lite", "Diagramly for Confluence"). Used for both the page
// title and the in-body copy, so a ZenUML (lite/full) tenant never sees
// Diagramly branding on its own examples page.
export const APP_LABEL = process.env.APP_LABEL || 'Diagramly for Confluence';
export const DEMO_PAGE_TITLE = `Welcome to ${APP_LABEL} — Try it out`;

// Mirrors ApWrapper2.getCustomContentType(): `ac:${CONNECT_KEY}:${CUSTOM_CONTENT_KEY}`.
export const CUSTOM_CONTENT_TYPE = `ac:${process.env.CONNECT_KEY || 'gptdock-confluence'}:${process.env.CUSTOM_CONTENT_KEY || 'gpt-custom-content-key'}`;
// Back-compat alias — this constant predates the multi-variant support above
// and existing callers/tests import it by this name. It now reflects
// whichever variant's env the function is running under, not always Diagramly.
export const DIAGRAMLY_CUSTOM_CONTENT_TYPE = CUSTOM_CONTENT_TYPE;

const SEQUENCE_BODY = `title Order Service
@Actor Client
@Boundary OrderController
@EC2 OrderService
Client -> OrderController.post(payload) {
  OrderService.create(payload) {
    return order
  }
}`;

const MERMAID_BODY = `flowchart LR
  Idea --> Draft
  Draft --> Review
  Review --> Ship`;

// Kept variant-neutral ("Try it here", not a product name) so the same
// literal works for every variant without runtime interpolation.
const GRAPH_XML = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="827" pageHeight="1169"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Start" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="120" y="80" width="120" height="40" as="geometry"/></mxCell><mxCell id="3" value="Try it here" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="120" y="160" width="120" height="40" as="geometry"/></mxCell><mxCell id="4" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>`;

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

// Body shapes mirror what CustomContentStorageProvider.save() writes for each
// diagram type (see tests/e2e-tests/utils/page-creator.ts for the canonical
// per-type shape — that recipe is proven to render in the E2E suite).
export const MACROS = [
  {
    id: 'sequence',
    macroKey: SEQUENCE_MACRO_KEY,
    diagramType: 'sequence',
    sectionTitle: 'Sequence diagram (ZenUML)',
    sectionLead: 'Describe how components or actors talk to each other.',
    contentTitle: 'Demo · Sequence diagram',
    body: {
      title: 'Order Service (Demonstration only)',
      code: SEQUENCE_BODY,
      mermaidCode: '',
      diagramType: 'sequence',
    },
  },
  {
    id: 'mermaid',
    macroKey: SEQUENCE_MACRO_KEY,
    diagramType: 'mermaid',
    sectionTitle: 'Flowchart (Mermaid)',
    sectionLead: 'Map a process top-to-bottom or left-to-right.',
    contentTitle: 'Demo · Flowchart',
    body: {
      title: 'Idea to Ship',
      code: '',
      mermaidCode: MERMAID_BODY,
      diagramType: 'mermaid',
    },
  },
  {
    id: 'graph',
    macroKey: GRAPH_MACRO_KEY,
    diagramType: 'graph',
    sectionTitle: 'Graph (DrawIO)',
    sectionLead: 'Free-form diagrams powered by DrawIO.',
    contentTitle: 'Demo · Graph',
    body: {
      diagramType: 'graph',
      graphXml: GRAPH_XML,
    },
  },
  {
    id: 'openapi',
    macroKey: OPENAPI_MACRO_KEY,
    diagramType: 'openapi',
    sectionTitle: 'OpenAPI / Swagger',
    sectionLead: 'Render an API spec inline.',
    contentTitle: 'Demo · OpenAPI',
    body: {
      title: '',
      code: OPENAPI_BODY,
      mermaidCode: '',
      styles: '',
      source: 'CustomContent',
      diagramType: 'openapi',
    },
  },
];

// MACRO_KEYS exposed for test/manifest cross-check. zenuml-embed-macro is
// intentionally omitted — CI strips it from the diagramly build.
export const MACRO_KEYS = Array.from(new Set(MACROS.map(m => m.macroKey)));

const paragraph = (text) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const heading = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

// Forge ARI ADF extension form. Connect-style (`com.atlassian.confluence.macro.core`
// with bare module keys) is ambiguous on sites that have other ZenUml apps
// installed — Confluence picked the Full app's `zenuml-openapi-macro` over
// ours when both were present (verified live on a Full+Diagramly site). The
// Forge form scopes the extensionKey to `<appId>/<environmentId>/static/<moduleKey>`
// so Confluence routes the macro to the Diagramly app unambiguously.
//
// Reference shape (sampled from a smoke-test page where the editor inserted
// the same macros via the UI):
//   extensionType: 'com.atlassian.ecosystem'
//   extensionKey:  '<appId>/<environmentId>/static/<moduleKey>'
//   parameters: {
//     extensionId:   'ari:cloud:ecosystem::extension/<extensionKey>',
//     localId:       <uuid>,
//     layout:        'extension',
//     forgeEnvironment: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION',
//     guestParams: { customContentId: <id-as-string>, updatedAt: <iso> }
//   }
const macroExtension = ({ macroKey, customContentId, appId, environmentId, environmentType }) => {
  const extensionKey = `${appId}/${environmentId}/static/${macroKey}`;
  return {
    type: 'extension',
    attrs: {
      extensionType: 'com.atlassian.ecosystem',
      extensionKey,
      parameters: {
        extensionId: `ari:cloud:ecosystem::extension/${extensionKey}`,
        localId: randomUuid(),
        layout: 'extension',
        forgeEnvironment: environmentType,
        guestParams: {
          customContentId: String(customContentId),
          updatedAt: new Date().toISOString(),
        },
      },
    },
  };
};

function randomUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// forgeContext: { appId, environmentId, environmentType }
//   - appId / environmentId pin the ADF extension to the calling variant's own
//     Forge module even on sites with overlapping Connect-era macro keys.
//   - environmentType ('DEVELOPMENT' | 'STAGING' | 'PRODUCTION') flows into
//     `parameters.forgeEnvironment` to match the shape Confluence stores.
// idToContentId: { [macro.id]: customContentId-string }
// Throws if any MACROS entry is missing from the map.
export function buildDemoPageAdf(idToContentId, forgeContext) {
  if (!forgeContext || !forgeContext.appId || !forgeContext.environmentId || !forgeContext.environmentType) {
    throw new Error('buildDemoPageAdf: forgeContext { appId, environmentId, environmentType } required');
  }
  const { appId, environmentId, environmentType } = forgeContext;

  const content = [
    heading(1, 'Welcome 👋'),
    paragraph(
      `This page was created by ${APP_LABEL} so you can try the diagram types we support. Edit any macro to play with the source.`,
    ),
  ];

  for (const macro of MACROS) {
    const contentId = idToContentId[macro.id];
    if (!contentId) {
      throw new Error(`buildDemoPageAdf: missing customContentId for macro id "${macro.id}"`);
    }
    content.push(heading(2, macro.sectionTitle));
    content.push(paragraph(macro.sectionLead));
    content.push(macroExtension({
      macroKey: macro.macroKey,
      customContentId: contentId,
      appId,
      environmentId,
      environmentType,
    }));
  }

  content.push(heading(2, 'Not for you?'));
  content.push(
    paragraph(
      `Delete this page if you would rather not see it — ${APP_LABEL} will not recreate it.`,
    ),
  );

  return { type: 'doc', version: 1, content };
}
