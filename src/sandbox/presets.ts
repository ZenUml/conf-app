export interface SandboxPreset {
  id: string;
  label: string;
  group: 'Sequence' | 'Graph' | 'OpenAPI' | 'Embed';
  moduleKey: string;
  macroMode: 'editor' | 'viewer';
  diagramType: string;
  customContentId?: string;
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
