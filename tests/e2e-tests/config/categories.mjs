export const CATEGORY_VERSION = 'v1';
export const VARIANTS = ['lite', 'full', 'diagramly', 'asyncapi'];
export const CATEGORIES = [
  {
    "id": "agent-link-e2e",
    "description": "agent link e2e behavior exercised by agent-link/agent-link-e2e.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "agent-link/agent-link-e2e.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "agent-link-multi-page-crosstalk",
    "description": "agent link multi page crosstalk behavior exercised by agent-link/agent-link-multi-page-crosstalk.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "agent-link/agent-link-multi-page-crosstalk.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "asyncapi-create-edit",
    "description": "asyncapi create edit behavior exercised by asyncapi/create-edit.spec.ts",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "asyncapi/create-edit.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "asyncapi-dashboard-loads",
    "description": "asyncapi dashboard loads behavior exercised by asyncapi/dashboard-loads.spec.ts",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "asyncapi/dashboard-loads.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "asyncapi-macro-create-edit",
    "description": "asyncapi macro create edit behavior exercised by asyncapi/macro-create-edit.spec.ts",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "asyncapi/macro-create-edit.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "byline-activation",
    "description": "byline activation behavior exercised by insert/byline-activation.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-activation.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "byline-asyncapi",
    "description": "byline asyncapi behavior exercised by insert/byline-asyncapi.spec.ts",
    "variants": [
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-asyncapi.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "byline-create",
    "description": "byline create behavior exercised by insert/byline-create.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-create.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "byline-paywall",
    "description": "byline paywall behavior exercised by insert/byline-paywall.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/byline-paywall.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "copy-for-ai",
    "description": "copy for ai behavior exercised by fullscreen/copy-for-ai.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/copy-for-ai.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "cross-cutting",
    "description": "cross cutting behavior exercised by fullscreen/cross-cutting.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/cross-cutting.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "csat-banner",
    "description": "csat banner behavior exercised by fullscreen/csat-banner.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/csat-banner.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "draft-only-binding-fork",
    "description": "draft only binding fork behavior exercised by fullscreen/draft-only-binding-fork.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/draft-only-binding-fork.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "draft-only-binding-samepage",
    "description": "draft only binding samepage behavior exercised by fullscreen/draft-only-binding-samepage.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/draft-only-binding-samepage.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "edit-graph",
    "description": "edit graph behavior exercised by insert/edit-graph.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/edit-graph.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "embed-deeplink-autoconvert",
    "description": "embed deeplink autoconvert behavior exercised by insert/embed-deeplink-autoconvert.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/embed-deeplink-autoconvert.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "embed-edit-document-list",
    "description": "embed edit document list behavior exercised by render/embed-edit-document-list.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/embed-edit-document-list.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "embed-render",
    "description": "embed render behavior exercised by render/embed.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/embed.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "feedback-report",
    "description": "feedback report behavior exercised by feedback/feedback-report.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "feedback/feedback-report.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "fetch-phase-telemetry",
    "description": "fetch phase telemetry behavior exercised by render/fetch-phase-telemetry.spec.ts",
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
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "graph",
    "description": "graph behavior exercised by insert/graph.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/graph.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "graph-create",
    "description": "graph create behavior exercised by fullscreen/graph-create.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/graph-create.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "graph-edit",
    "description": "graph edit behavior exercised by fullscreen/graph-edit.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/graph-edit.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "graph-render",
    "description": "graph render behavior exercised by render/graph.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/graph.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "lite2full-render",
    "description": "lite2full render behavior exercised by conversion/lite2full-render.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "conversion/lite2full-render.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "m1-first-seen-ping",
    "description": "m1 first seen ping behavior exercised by insert/m1-first-seen-ping.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/m1-first-seen-ping.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "mermaid",
    "description": "mermaid behavior exercised by insert/mermaid.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/mermaid.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "mermaid-render",
    "description": "mermaid render behavior exercised by render/mermaid.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/mermaid.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "mermaid-syntax",
    "description": "mermaid syntax behavior exercised by syntax-validation/mermaid.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "syntax-validation/mermaid.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "openapi",
    "description": "openapi behavior exercised by insert/openapi.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/openapi.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "openapi-create",
    "description": "openapi create behavior exercised by fullscreen/openapi-create.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/openapi-create.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "openapi-edit",
    "description": "openapi edit behavior exercised by fullscreen/openapi-edit.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/openapi-edit.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "openapi-render",
    "description": "openapi render behavior exercised by render/openapi.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/openapi.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "openapi-syntax",
    "description": "openapi syntax behavior exercised by syntax-validation/openapi.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly",
      "asyncapi"
    ],
    "dependencies": [],
    "positive_examples": [
      "syntax-validation/openapi.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "page-actions",
    "description": "page actions behavior exercised by fullscreen/page-actions.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/page-actions.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "paywall-page-banner",
    "description": "paywall page banner behavior exercised by insert/paywall-page-banner.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/paywall-page-banner.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "plantuml",
    "description": "plantuml behavior exercised by insert/plantuml.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/plantuml.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "plantuml-syntax",
    "description": "plantuml syntax behavior exercised by syntax-validation/plantuml.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "syntax-validation/plantuml.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "regression",
    "description": "regression behavior exercised by fullscreen/regression.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/regression.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "sequence",
    "description": "sequence behavior exercised by insert/sequence.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/sequence.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "sequence-create",
    "description": "sequence create behavior exercised by fullscreen/sequence-create.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/sequence-create.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "sequence-edit",
    "description": "sequence edit behavior exercised by fullscreen/sequence-edit.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/sequence-edit.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "sequence-render",
    "description": "sequence render behavior exercised by render/sequence.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/sequence.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "sequence-syntax",
    "description": "sequence syntax behavior exercised by syntax-validation/sequence.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "syntax-validation/sequence.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "typed-deeplink-autoconvert",
    "description": "typed deeplink autoconvert behavior exercised by insert/typed-deeplink-autoconvert.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/typed-deeplink-autoconvert.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "typed-deeplink-render",
    "description": "typed deeplink render behavior exercised by insert/typed-deeplink-render.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "insert/typed-deeplink-render.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "viewer-actions",
    "description": "viewer actions behavior exercised by fullscreen/viewer-actions.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/viewer-actions.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "viewport-graph",
    "description": "viewport graph behavior exercised by render/viewport-graph.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/viewport-graph.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "viewport-mermaid",
    "description": "viewport mermaid behavior exercised by render/viewport-mermaid.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/viewport-mermaid.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "viewport-sequence",
    "description": "viewport sequence behavior exercised by render/viewport-sequence.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "render/viewport-sequence.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  },
  {
    "id": "writeback-gate-non-submittable",
    "description": "writeback gate non submittable behavior exercised by fullscreen/writeback-gate-non-submittable.spec.ts",
    "variants": [
      "lite",
      "full",
      "diagramly"
    ],
    "dependencies": [],
    "positive_examples": [
      "fullscreen/writeback-gate-non-submittable.spec.ts"
    ],
    "negative_examples": [
      "unrelated diagram behavior"
    ]
  }
];
