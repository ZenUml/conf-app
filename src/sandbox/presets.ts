export interface SandboxPreset {
  id: string;
  label: string;
  group: 'Sequence' | 'Graph' | 'OpenAPI' | 'Embed' | 'Paywall';
  moduleKey: string;
  macroMode: 'editor' | 'viewer';
  diagramType: string;
  customContentId?: string;
  /**
   * When true, the standalone bootstrap (forgeGlobal.applyStandaloneContext)
   * sets localStorage.mock{MacroCount,CSSEnabled,SpacePaid,SpaceKey,ClientDomain}
   * so the paywall fires immediately. Used for visual review of the editor +
   * advocacy-modal overlay UX without needing to type the mocks by hand.
   */
  paywall?: boolean;
}

export const SANDBOX_PRESETS: Record<string, SandboxPreset> = {
  'seq-view': {
    id: 'seq-view',
    label: 'Sequence – Viewer',
    group: 'Sequence',
    moduleKey: 'zenuml-sequence-macro',
    macroMode: 'viewer',
    diagramType: 'sequence',
    customContentId: 'fake-content-id-diagram-sequence',
  },
  'seq-edit': {
    id: 'seq-edit',
    label: 'Sequence – Editor',
    group: 'Sequence',
    moduleKey: 'zenuml-sequence-macro',
    macroMode: 'editor',
    diagramType: 'sequence',
    customContentId: 'fake-content-id-diagram-sequence',
  },
  'seq-new': {
    id: 'seq-new',
    label: 'Sequence – New (Insert)',
    group: 'Sequence',
    moduleKey: 'zenuml-sequence-macro',
    macroMode: 'editor',
    diagramType: 'sequence',
  },
  'mermaid-view': {
    id: 'mermaid-view',
    label: 'Mermaid – Viewer',
    group: 'Sequence',
    moduleKey: 'zenuml-sequence-macro',
    macroMode: 'viewer',
    diagramType: 'mermaid',
    customContentId: 'fake-content-id-diagram-mermaid',
  },
  'mermaid-edit': {
    id: 'mermaid-edit',
    label: 'Mermaid – Editor',
    group: 'Sequence',
    moduleKey: 'zenuml-sequence-macro',
    macroMode: 'editor',
    diagramType: 'mermaid',
    customContentId: 'fake-content-id-diagram-mermaid',
  },
  'graph-view': {
    id: 'graph-view',
    label: 'Graph – Viewer',
    group: 'Graph',
    moduleKey: 'zenuml-graph-macro',
    macroMode: 'viewer',
    diagramType: 'graph',
    customContentId: 'fake-content-id-diagram-graph',
  },
  'graph-edit': {
    id: 'graph-edit',
    label: 'Graph – Editor',
    group: 'Graph',
    moduleKey: 'zenuml-graph-macro',
    macroMode: 'editor',
    diagramType: 'graph',
    customContentId: 'fake-content-id-diagram-graph',
  },
  'openapi-view': {
    id: 'openapi-view',
    label: 'OpenAPI – Viewer',
    group: 'OpenAPI',
    moduleKey: 'zenuml-openapi-macro',
    macroMode: 'viewer',
    diagramType: 'openapi',
    customContentId: 'fake-content-id-diagram-openapi',
  },
  'openapi-edit': {
    id: 'openapi-edit',
    label: 'OpenAPI – Editor',
    group: 'OpenAPI',
    moduleKey: 'zenuml-openapi-macro',
    macroMode: 'editor',
    diagramType: 'openapi',
    customContentId: 'fake-content-id-diagram-openapi',
  },
  'embed-edit': {
    id: 'embed-edit',
    label: 'Embed – Editor',
    group: 'Embed',
    moduleKey: 'zenuml-embed-macro',
    macroMode: 'editor',
    diagramType: 'embed',
  },
  'paywall-seq-edit': {
    id: 'paywall-seq-edit',
    label: 'Sequence – Editor + Paywall',
    group: 'Paywall',
    moduleKey: 'zenuml-sequence-macro',
    macroMode: 'editor',
    diagramType: 'sequence',
    customContentId: 'fake-content-id-diagram-sequence',
    paywall: true,
  },
  'paywall-graph-edit': {
    id: 'paywall-graph-edit',
    label: 'Graph – Editor + Paywall',
    group: 'Paywall',
    moduleKey: 'zenuml-graph-macro',
    macroMode: 'editor',
    diagramType: 'graph',
    customContentId: 'fake-content-id-diagram-graph',
    paywall: true,
  },
  'paywall-openapi-edit': {
    id: 'paywall-openapi-edit',
    label: 'OpenAPI – Editor + Paywall',
    group: 'Paywall',
    moduleKey: 'zenuml-openapi-macro',
    macroMode: 'editor',
    diagramType: 'openapi',
    customContentId: 'fake-content-id-diagram-openapi',
    paywall: true,
  },
  'paywall-embed-edit': {
    id: 'paywall-embed-edit',
    label: 'Embed – Editor + Paywall',
    group: 'Paywall',
    moduleKey: 'zenuml-embed-macro',
    macroMode: 'editor',
    diagramType: 'embed',
    paywall: true,
  },
};

export function getPresetById(id: string): SandboxPreset | undefined {
  return SANDBOX_PRESETS[id];
}

export function getPresetGroups(): Record<string, SandboxPreset[]> {
  const groups: Record<string, SandboxPreset[]> = {};
  for (const preset of Object.values(SANDBOX_PRESETS)) {
    (groups[preset.group] ??= []).push(preset);
  }
  return groups;
}
