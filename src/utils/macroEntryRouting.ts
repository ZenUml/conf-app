/**
 * Every macro module in manifest.yml uses `resource: main`, so `index.html` →
 * `forgeIndex.ts` is the single Custom UI entry for ALL macro types. From that
 * shared entry, `loadHeavyComponents` renders the sequence-family diagrams
 * (sequence / mermaid / plantuml, all under the `zenuml-sequence-macro` module)
 * itself via Workspace / DiagramPortal, but DELEGATES graph / openapi / embed /
 * asyncapi to a dedicated viewer/editor entry (`forge-graph-*`, `forge-swagger-*`,
 * `forge-embed-*`, `forge-asyncapi-*`).
 *
 * Those dedicated entries own their OWN custom-content load and their OWN
 * `customcontent_orphan_observed` telemetry. When the shared entry also loaded
 * the doc and fired `reportOrphanObserved`, non-sequence macros emitted the
 * orphan event TWICE per load — once mislabeled `diagram_kind: 'sequence'` from
 * the shared entry and once correctly-labeled from the delegate — inflating the
 * orphan dashboards ~2× for graph/openapi/embed. This predicate is the single
 * source of truth the shared entry uses to decide "do I render (and therefore
 * load + report) this macro myself?" so the shared-entry load can be gated to
 * sequence-family only.
 *
 * Mirrors the `isSequence` discriminator historically inlined in
 * `loadHeavyComponents`. `modalDiagramType` is `context.extension.modal?.diagramType`
 * — set when a modal (view-mode Edit / fullscreen) is opened from the sequence
 * viewer and carries no macro moduleKey of its own.
 */
export function isSequenceFamilyEntry(
  moduleKey: string | undefined,
  modalDiagramType?: string | undefined,
): boolean {
  return (
    !!moduleKey &&
    (moduleKey.startsWith('zenuml-sequence-macro') ||
      moduleKey.startsWith('gpt-diagram-macro'))
  ) ||
    modalDiagramType === 'sequence' ||
    modalDiagramType === 'mermaid';
}
