/**
 * Global Window interface extensions for the conf-app project.
 * Consolidates all window property declarations to avoid TS2687 conflicts.
 */
declare global {
  interface Window {
    // Common diagram property used across forge entry points
    diagram: any;
    picked?: any;

    // Graph-related properties (forge-graph-editor, forge-graph-viewer)
    graphXml?: string;
    graph: any;
    Graph?: any;
    setGraphStyle?: (styleUrl: string, graph: any) => void;
    setGraphXml?: (xml: string, graph: any) => void;
    updateGraph?: (xml: string) => void;

    // Swagger/OpenAPI-related properties (forge-swagger-editor, forge-swagger-ui)
    updateSpec: (spec: string) => void;
    specContent: string;
    specListeners: ((spec: string) => void)[];
    editor: any;
    SwaggerEditorBundle: any;
    SwaggerUIBundle: any;
    ui: any;

    // Attachment guard (model/Attachment.ts)
    createAttachmentInProgress?: boolean;
  }
}

export {};
