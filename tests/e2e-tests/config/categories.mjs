export const CATEGORY_VERSION = 'v1';
export const VARIANTS = ['lite', 'full', 'diagramly', 'asyncapi'];
export const CATEGORIES = [
  {
    "id": "agent-link-e2e",
    "description": "Live Agent Link \u2014 end to end. Verifies agent connects, reads the page + diagram, edits it live, and the macro shows connected; TTL slides on agent activity (PR1 sliding window).",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "agent-link/agent-link-e2e.spec.ts",
      "agent connects, reads the page + diagram, edits it live, and the macro shows connected",
      "TTL slides on agent activity (PR1 sliding window)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "agent-link-multi-page-crosstalk",
    "description": "Live Agent Link \u2014 multi-page cross-talk isolation. Verifies two concurrent sessions on two different pages never leak edits across each other.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "agent-link/agent-link-multi-page-crosstalk.spec.ts",
      "two concurrent sessions on two different pages never leak edits across each other"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "asyncapi-create-edit",
    "description": "AsyncAPI create + edit. Verifies create: ; edit: a card\\; create: .",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [
      "openapi-render"
    ],
    "positive_examples": [
      "asyncapi/create-edit.spec.ts",
      "create: ",
      "edit: a card\\",
      "create: "
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "asyncapi-dashboard-loads",
    "description": "AsyncAPI smoke. Verifies asyncapi dashboard loads.",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "asyncapi/dashboard-loads.spec.ts"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "asyncapi-macro-create-edit",
    "description": "AsyncAPI macro create + edit. Verifies create: insert AsyncAPI Spec macro, publish page, macro renders; edit: viewer Edit button opens the spec editor, Publish updates in place.",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "asyncapi/macro-create-edit.spec.ts",
      "create: insert AsyncAPI Spec macro, publish page, macro renders",
      "edit: viewer Edit button opens the spec editor, Publish updates in place"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "byline-activation",
    "description": "byline activation nudge. Verifies prepared: chip appears only when the property is set, and opens the dialog.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-activation.spec.ts",
      "prepared: chip appears only when the property is set, and opens the dialog"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "byline-asyncapi",
    "description": "Verifies offers an AsyncAPI tile and hands back a typed asyncapi deeplink; pasting that link places an AsyncAPI macro that renders the saved spec.",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-asyncapi.spec.ts",
      "offers an AsyncAPI tile and hands back a typed asyncapi deeplink",
      "pasting that link places an AsyncAPI macro that renders the saved spec"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "byline-create",
    "description": "Create a diagram from the Confluence page byline, edit and persist its custom content, then copy/place its link back into a page.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "insert/byline-create.spec.ts",
      "lists the page\\",
      "creating from INSIDE the editor drops the redundant "
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "byline-paywall",
    "description": "Verifies picking a type on an over-limit space still lands on a usable editor.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-paywall.spec.ts",
      "picking a type on an over-limit space still lands on a usable editor"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "copy-for-ai",
    "description": "Copy for AI button. Verifies copy-for-ai:0 \u2014 visible on a Mermaid macro, copies diagram + page context, and fires copy_for_ai_clicked; copy-for-ai:1 \u2014 absent on a Graph macro (not a text-DSL type).",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/copy-for-ai.spec.ts",
      "copy-for-ai:0 \u2014 visible on a Mermaid macro, copies diagram + page context, and fires copy_for_ai_clicked",
      "copy-for-ai:1 \u2014 absent on a Graph macro (not a text-DSL type)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "cross-cutting",
    "description": "Forge fullscreen modal chrome and lifecycle: maximize/restore, close button, Escape dismissal, focus and page scroll restoration, and navigation guards across editors.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/cross-cutting.spec.ts",
      "cross:0 \u2014 modal occupies full viewport, iframe sits below header",
      "cross:1 \u2014 single header X close button, none inside iframe",
      "cross:3 \u2014 modal has aria-modal=true (no chrome reachable)",
      "cross:4 \u2014 clean state: header X dismisses without prompt",
      "cross:5 \u2014 dirty state: synthetic beforeunload is preventDefault=true",
      "cross:6 \u2014 Esc on dirty sequence editor does NOT close modal",
      "Change fullscreen modal Escape or close handling",
      "Change modal maximization or focus restoration"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "csat-banner",
    "description": "CSAT pageBanner. Verifies banner appears after macro creation; banner appears after macro edit; clicking a score expands inline text area; Send closes banner and suppresses for 3 months; Dismiss without score closes banner.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/csat-banner.spec.ts",
      "banner appears after macro creation",
      "banner appears after macro edit",
      "clicking a score expands inline text area",
      "Send closes banner and suppresses for 3 months",
      "Dismiss without score closes banner",
      "\u00d7 dismiss closes banner and suppresses"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "draft-only-binding-fork",
    "description": "REGRESSION #169 \u2014 draft-only binding updates in place (no fork). Verifies edit-via-modal of a draft-only-bound macro closes cleanly and does not fork.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/draft-only-binding-fork.spec.ts",
      "edit-via-modal of a draft-only-bound macro closes cleanly and does not fork"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "draft-only-binding-samepage",
    "description": "SAME-PAGE #169 \u2014 one page: broken on buggy deploy \u2192 fixed on fixed deploy. Verifies PHASE B (fixed): reopen that same page, edit succeeds (modal closes, no fork).",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/draft-only-binding-samepage.spec.ts",
      "PHASE B (fixed): reopen that same page, edit succeeds (modal closes, no fork)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "edit-graph",
    "description": "Verifies insert Graph (DrawIO) macro, then edit and re-save.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "insert/edit-graph.spec.ts",
      "insert Graph (DrawIO) macro, then edit and re-save"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "embed-deeplink-autoconvert",
    "description": "Verifies pasting a /d/ deeplink converts to the embed macro (not a smart-link).",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "embed-render"
    ],
    "positive_examples": [
      "insert/embed-deeplink-autoconvert.spec.ts",
      "pasting a /d/ deeplink converts to the embed macro (not a smart-link)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "embed-edit-document-list",
    "description": "Embed editor \u2014 document list (search type-scoping). Verifies opening the embed editor lists existing diagrams.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "embed-render"
    ],
    "positive_examples": [
      "render/embed-edit-document-list.spec.ts",
      "opening the embed editor lists existing diagrams"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "embed-render",
    "description": "Embed Diagram Tests. Verifies should display embed diagram correctly.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/embed.spec.ts",
      "should display embed diagram correctly"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "feedback-report",
    "description": "Send feedback dialog opening and submit success/failure across viewer, editor, fullscreen and export surfaces; preserves context and diagnostics.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "feedback/feedback-report.spec.ts",
      "editor, fullscreen, viewer and PNG export surfaces",
      "submitting with a description saves a report and returns a reference"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "fetch-phase-telemetry",
    "description": "macro_viewed fetch phase. Verifies fetch phase telemetry.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/fetch-phase-telemetry.spec.ts"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "graph",
    "description": "Verifies insert Graph (DrawIO) macro and verify render.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "insert/graph.spec.ts",
      "insert Graph (DrawIO) macro and verify render"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "graph-create",
    "description": "Graph (DrawIO) \u2014 Create flow. Verifies graph-create:0 \u2014 macro is findable in the element browser; graph-create:1 \u2014 modal opens at fullscreen viewport; graph-create:2 \u2014 DrawIO canvas and shape library mount; graph-create:4 \u2014 Publish closes modal and inserts the macro; graph-create:5 \u2014 clean editor: synthetic beforeunload is false.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "fullscreen/graph-create.spec.ts",
      "graph-create:0 \u2014 macro is findable in the element browser",
      "graph-create:1 \u2014 modal opens at fullscreen viewport",
      "graph-create:2 \u2014 DrawIO canvas and shape library mount",
      "graph-create:4 \u2014 Publish closes modal and inserts the macro",
      "graph-create:5 \u2014 clean editor: synthetic beforeunload is false",
      "graph-create:6 \u2014 dirty editor (autosave message): synthetic beforeunload is true"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "graph-edit",
    "description": "Graph (DrawIO) \u2014 Edit flow. Verifies graph-edit:0 \u2014 Edit button opens fullscreen modal; graph-edit:1 \u2014 an autosave with xml reaches the persisted draft; graph-edit:2 \u2014 Publish closes the modal; graph-edit:5 \u2014 Diagram Publish is visible and closes the modal; graph-edit:6 \u2014 Board Publish is visible and closes the modal.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "fullscreen/graph-edit.spec.ts",
      "graph-edit:0 \u2014 Edit button opens fullscreen modal",
      "graph-edit:1 \u2014 an autosave with xml reaches the persisted draft",
      "graph-edit:2 \u2014 Publish closes the modal",
      "graph-edit:5 \u2014 Diagram Publish is visible and closes the modal",
      "graph-edit:6 \u2014 Board Publish is visible and closes the modal",
      "graph-edit:7 \u2014 publish Board content and render it in the viewer"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "graph-render",
    "description": "Graph Diagram Tests. Verifies should display graph diagram correctly.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/graph.spec.ts",
      "should display graph diagram correctly"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "lite2full-render",
    "description": "Lite->Full converted macro renders. Verifies lite2full render.",
    "variants": [
      "full"
    ],
    "dependencies": [],
    "positive_examples": [
      "conversion/lite2full-render.spec.ts"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "m1-first-seen-ping",
    "description": "Verifies identifies only the target app page-banner first-seen relay; first-seen ping completes from the target app page-banner.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/m1-first-seen-ping.spec.ts",
      "identifies only the target app page-banner first-seen relay",
      "first-seen ping completes from the target app page-banner"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "mermaid",
    "description": "Verifies insert Mermaid macro and verify render.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "mermaid-render"
    ],
    "positive_examples": [
      "insert/mermaid.spec.ts",
      "insert Mermaid macro and verify render"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "mermaid-render",
    "description": "Mermaid Diagram Tests. Verifies should display mermaid diagram correctly.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/mermaid.spec.ts",
      "should display mermaid diagram correctly"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "mermaid-syntax",
    "description": "Mermaid Syntax Error Detection. Verifies should detect syntax error in Mermaid diagram.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "mermaid-render"
    ],
    "positive_examples": [
      "syntax-validation/mermaid.spec.ts",
      "should detect syntax error in Mermaid diagram"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "openapi",
    "description": "Verifies insert OpenAPI / Swagger macro and verify render.",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [
      "openapi-render"
    ],
    "positive_examples": [
      "insert/openapi.spec.ts",
      "insert OpenAPI / Swagger macro and verify render"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "openapi-create",
    "description": "OpenAPI / Swagger \u2014 Create flow. Verifies openapi-create:0 \u2014 macro is findable in the element browser; openapi-create:1 \u2014 modal opens at fullscreen viewport; openapi-create:2 \u2014 default Sample API spec is mounted; openapi-create:3 \u2014 typing in YAML editor changes the buffer; openapi-create:4 \u2014 Publish closes modal and inserts the macro.",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [
      "openapi-render"
    ],
    "positive_examples": [
      "fullscreen/openapi-create.spec.ts",
      "openapi-create:0 \u2014 macro is findable in the element browser",
      "openapi-create:1 \u2014 modal opens at fullscreen viewport",
      "openapi-create:2 \u2014 default Sample API spec is mounted",
      "openapi-create:3 \u2014 typing in YAML editor changes the buffer",
      "openapi-create:4 \u2014 Publish closes modal and inserts the macro",
      "openapi-create:5 \u2014 clean dispatch returns a boolean (race-tolerant)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "openapi-edit",
    "description": "OpenAPI / Swagger \u2014 Edit flow. Verifies openapi-edit:0 \u2014 Edit button opens fullscreen modal with saved spec; openapi-edit:1 \u2014 typing in YAML changes the buffer; openapi-edit:2 \u2014 Publish closes the modal; openapi-edit:3 \u2014 re-open clean: synthetic beforeunload is false; openapi-edit:4 \u2014 a dirty re-opened editor persists a recoverable draft.",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [
      "openapi-render"
    ],
    "positive_examples": [
      "fullscreen/openapi-edit.spec.ts",
      "openapi-edit:0 \u2014 Edit button opens fullscreen modal with saved spec",
      "openapi-edit:1 \u2014 typing in YAML changes the buffer",
      "openapi-edit:2 \u2014 Publish closes the modal",
      "openapi-edit:3 \u2014 re-open clean: synthetic beforeunload is false",
      "openapi-edit:4 \u2014 a dirty re-opened editor persists a recoverable draft"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "openapi-render",
    "description": "OpenAPI Diagram Tests. Verifies should display OpenAPI diagram correctly; should open fullscreen with correct layout.",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/openapi.spec.ts",
      "should display OpenAPI diagram correctly",
      "should open fullscreen with correct layout"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "openapi-syntax",
    "description": "OpenAPI Syntax Error Detection. Verifies should detect syntax error in OpenAPI specification.",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [
      "openapi-render"
    ],
    "positive_examples": [
      "syntax-validation/openapi.spec.ts",
      "should detect syntax error in OpenAPI specification"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "page-actions",
    "description": "Fullscreen page and editor actions including publish, cancel, modal closing, dirty state and page navigation.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/page-actions.spec.ts",
      "page-actions:0 \u2014 page transitions from edit-v2 to view URL after publish",
      "page-actions:1 \u2014 Publish dialog has location + access fields",
      "page-actions:2 \u2014 clean published page: synthetic beforeunload on top page is false"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "paywall-page-banner",
    "description": "Paywall page banner. Verifies hard limit: banner renders with the count and the primary CTA opens Plan and usage; dismiss snoozes \u2014 banner gone after reload despite the warning marker.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/paywall-page-banner.spec.ts",
      "hard limit: banner renders with the count and the primary CTA opens Plan and usage",
      "dismiss snoozes \u2014 banner gone after reload despite the warning marker"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "plantuml",
    "description": "Verifies insert PlantUML macro and verify render.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/plantuml.spec.ts",
      "insert PlantUML macro and verify render"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "plantuml-syntax",
    "description": "PlantUML Syntax Error Detection. Verifies should detect syntax error in PlantUML diagram - invalid arrow syntax.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "syntax-validation/plantuml.spec.ts",
      "should detect syntax error in PlantUML diagram - invalid arrow syntax"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "regression",
    "description": "Regression baseline. Verifies regression:0 \u2014 pnpm test:unit passes; regression:2 \u2014 insert smoke specs pass on lite-stg.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/regression.spec.ts",
      "regression:0 \u2014 pnpm test:unit passes",
      "regression:2 \u2014 insert smoke specs pass on lite-stg"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "sequence",
    "description": "Verifies insert Diagram macro and verify render.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "insert/sequence.spec.ts",
      "insert Diagram macro and verify render"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "sequence-create",
    "description": "Sequence \u2014 Create flow. Verifies sequence-create:0 \u2014 macro is findable in the element browser; sequence-create:1 \u2014 modal opens at fullscreen viewport (header 70px); sequence-create:2 \u2014 Sequence tab selected by default with sample code; sequence-create:3 \u2014 Mermaid tab switches editor mode; sequence-create:4 \u2014 PlantUML tab switches editor mode.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/sequence-create.spec.ts",
      "sequence-create:0 \u2014 macro is findable in the element browser",
      "sequence-create:1 \u2014 modal opens at fullscreen viewport (header 70px)",
      "sequence-create:2 \u2014 Sequence tab selected by default with sample code",
      "sequence-create:3 \u2014 Mermaid tab switches editor mode",
      "sequence-create:4 \u2014 PlantUML tab switches editor mode",
      "sequence-create:5 \u2014 Publish stays disabled while the title is empty (AI title unavailable)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "sequence-edit",
    "description": "Sequence \u2014 Edit flow. Verifies sequence-edit:0 \u2014 Edit button opens fullscreen modal with existing source; sequence-edit:1 \u2014 editor mounts with the saved source; sequence-edit:2 \u2014 typing in editor changes the buffer; sequence-edit:3 \u2014 Publish closes the modal after editing; sequence-edit:4 \u2014 re-open clean: synthetic beforeunload is false.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/sequence-edit.spec.ts",
      "sequence-edit:0 \u2014 Edit button opens fullscreen modal with existing source",
      "sequence-edit:1 \u2014 editor mounts with the saved source",
      "sequence-edit:2 \u2014 typing in editor changes the buffer",
      "sequence-edit:3 \u2014 Publish closes the modal after editing",
      "sequence-edit:4 \u2014 re-open clean: synthetic beforeunload is false",
      "sequence-edit:5 \u2014 re-open dirty: synthetic beforeunload is true"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "sequence-render",
    "description": "Sequence Diagram Tests. Verifies should display sequence diagram correctly; should edit sequence diagram successfully.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/sequence.spec.ts",
      "should display sequence diagram correctly",
      "should edit sequence diagram successfully"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "sequence-syntax",
    "description": "ZenUML Syntax Error Detection. Verifies should detect syntax error in ZenUML sequence diagram.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "syntax-validation/sequence.spec.ts",
      "should detect syntax error in ZenUML sequence diagram"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "typed-deeplink-autoconvert",
    "description": "Verifies typed deeplink autoconvert.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "insert/typed-deeplink-autoconvert.spec.ts"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "typed-deeplink-render",
    "description": "Verifies a pasted graph deeplink renders the diagram, not an empty canvas.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "insert/typed-deeplink-render.spec.ts",
      "a pasted graph deeplink renders the diagram, not an empty canvas"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "viewer-actions",
    "description": "Viewer toolbar actions. Verifies viewer-actions:0 \u2014 Sequence Fullscreen opens fullscreen viewer modal; viewer-actions:1 \u2014 Sequence Export opens an export UI; viewer-actions:2 \u2014 Sequence Copy Code puts source on clipboard; viewer-actions:3 \u2014 Sequence Versions logs version metadata; viewer-actions:4 \u2014 Graph Fullscreen opens fullscreen viewer modal.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/viewer-actions.spec.ts",
      "viewer-actions:0 \u2014 Sequence Fullscreen opens fullscreen viewer modal",
      "viewer-actions:1 \u2014 Sequence Export opens an export UI",
      "viewer-actions:2 \u2014 Sequence Copy Code puts source on clipboard",
      "viewer-actions:3 \u2014 Sequence Versions logs version metadata",
      "viewer-actions:4 \u2014 Graph Fullscreen opens fullscreen viewer modal",
      "viewer-actions:5 \u2014 Graph Export opens the shared Export PNG modal"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "viewport-graph",
    "description": "Graph pan/zoom viewport. Verifies offers zoom controls on the rendered macro; renders at natural size or smaller, never magnified; zooms in from the toolbar.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "graph-render"
    ],
    "positive_examples": [
      "render/viewport-graph.spec.ts",
      "offers zoom controls on the rendered macro",
      "renders at natural size or smaller, never magnified",
      "zooms in from the toolbar"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "viewport-mermaid",
    "description": "Mermaid pan/zoom viewport. Verifies offers zoom controls on the rendered macro; renders at natural size or smaller, never magnified; zooms in from the toolbar.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "mermaid-render"
    ],
    "positive_examples": [
      "render/viewport-mermaid.spec.ts",
      "offers zoom controls on the rendered macro",
      "renders at natural size or smaller, never magnified",
      "zooms in from the toolbar"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "viewport-sequence",
    "description": "Sequence pan/zoom viewport. Verifies offers zoom controls on the rendered macro; renders at natural size or smaller, never magnified; zooms in from the toolbar.",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "render/viewport-sequence.spec.ts",
      "offers zoom controls on the rendered macro",
      "renders at natural size or smaller, never magnified",
      "zooms in from the toolbar"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  },
  {
    "id": "writeback-gate-non-submittable",
    "description": "REGRESSION #170 / view-fork gate \u2014 copy shapes are stopped before the in-viewer modal. Verifies mechanism 2 \u2014 same-page duplicate (count>1): Edit is gated BEFORE the modal opens; mechanism 1 \u2014 cross-page copy disables in-viewer Edit (guard front-line).",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [
      "sequence-render"
    ],
    "positive_examples": [
      "fullscreen/writeback-gate-non-submittable.spec.ts",
      "mechanism 2 \u2014 same-page duplicate (count>1): Edit is gated BEFORE the modal opens",
      "mechanism 1 \u2014 cross-page copy disables in-viewer Edit (guard front-line)"
    ],
    "negative_examples": [
      "Changes confined to a different diagram format and not shared rendering, persistence, or UI controls."
    ]
  }
];
