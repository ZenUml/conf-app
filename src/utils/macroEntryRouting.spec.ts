import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSequenceFamilyEntry } from './macroEntryRouting';
import { reportOrphanObserved, type OrphanDiagramKind } from './orphanTelemetry';
import { trackEvent } from '@/utils/window';

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
}));

describe('isSequenceFamilyEntry', () => {
  // The sequence family (sequence/mermaid/plantuml) all ship under the
  // zenuml-sequence-macro module and are rendered by forgeIndex itself.
  it.each([
    'zenuml-sequence-macro-lite',
    'zenuml-sequence-macro-full',
    'zenuml-sequence-macro',
    'gpt-diagram-macro-lite',
  ])('returns true for the sequence-family module key %s', (moduleKey) => {
    expect(isSequenceFamilyEntry(moduleKey, undefined)).toBe(true);
  });

  // Non-sequence macros delegate to a dedicated viewer/editor, so forgeIndex
  // must NOT claim them (otherwise it double-fires the orphan event).
  it.each([
    'zenuml-graph-macro-lite',
    'zenuml-embed-macro-lite',
    'zenuml-openapi-macro-lite',
    'zenuml-asyncapi-macro',
    'zenuml-asyncapi-embed-macro',
  ])('returns false for the delegated module key %s', (moduleKey) => {
    expect(isSequenceFamilyEntry(moduleKey, undefined)).toBe(false);
  });

  // Modal contexts opened from the sequence viewer (view-mode Edit / fullscreen)
  // carry no macro moduleKey; they identify the family via modal.diagramType.
  it('returns true for a sequence modal diagramType regardless of moduleKey', () => {
    expect(isSequenceFamilyEntry(undefined, 'sequence')).toBe(true);
    expect(isSequenceFamilyEntry('zenuml-sequence-macro-lite', 'sequence')).toBe(true);
  });

  it('returns true for a mermaid modal diagramType', () => {
    expect(isSequenceFamilyEntry(undefined, 'mermaid')).toBe(true);
  });

  it('returns false for an asyncapi modal diagramType', () => {
    expect(isSequenceFamilyEntry(undefined, 'asyncapi')).toBe(false);
  });

  it('returns false when both moduleKey and modal diagramType are absent', () => {
    expect(isSequenceFamilyEntry(undefined, undefined)).toBe(false);
    expect(isSequenceFamilyEntry('', undefined)).toBe(false);
  });
});

/**
 * De-dup invariant (the #320/#321 follow-up fix). A single macro load must fire
 * `customcontent_orphan_observed` at most ONCE with the correct diagram_kind.
 *
 * `simulateOrphanReporters` mirrors the post-fix code paths that can report an
 * orphan for one load:
 *   - the shared Custom UI entry (forgeIndex.ts) — reports 'sequence' ONLY when
 *     it renders the macro itself, i.e. isSequenceFamilyEntry() is true;
 *   - the dedicated viewer/editor entry (forge-graph-*, forge-swagger-*,
 *     forge-embed-*) — reports its own diagram_kind for the type it owns.
 *
 * Before the fix, the shared entry reported for EVERY type (hardcoded
 * 'sequence'), so graph/openapi/embed loads double-fired. The gate on
 * isSequenceFamilyEntry is what makes this exactly-once.
 */
type MacroCase = {
  label: string;
  moduleKey: string | undefined;
  modalDiagramType?: string;
  /** the diagram_kind the dedicated entry reports, or null if forgeIndex renders it */
  delegateKind: OrphanDiagramKind | null;
  /** the single diagram_kind we expect to survive for one orphan load */
  expectedKind: OrphanDiagramKind;
};

function simulateOrphanReporters(c: MacroCase) {
  const isSequence = isSequenceFamilyEntry(c.moduleKey, c.modalDiagramType);
  // Shared entry (forgeIndex): only reports for the family it renders itself.
  if (isSequence) {
    reportOrphanObserved('page-1', 'orphan-1', 'sequence', undefined, { recoveryUsed: false });
  }
  // Dedicated entry: reports for the type it owns.
  if (!isSequence && c.delegateKind) {
    reportOrphanObserved('page-1', 'orphan-1', c.delegateKind, undefined, { recoveryUsed: false });
  }
}

describe('customcontent_orphan_observed fires exactly once per load', () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: MacroCase[] = [
    { label: 'sequence viewer/editor', moduleKey: 'zenuml-sequence-macro-lite', delegateKind: null, expectedKind: 'sequence' },
    { label: 'mermaid modal', moduleKey: undefined, modalDiagramType: 'mermaid', delegateKind: null, expectedKind: 'sequence' },
    { label: 'graph viewer/editor', moduleKey: 'zenuml-graph-macro-lite', delegateKind: 'graph', expectedKind: 'graph' },
    { label: 'openapi viewer/editor', moduleKey: 'zenuml-openapi-macro-lite', delegateKind: 'openapi', expectedKind: 'openapi' },
    { label: 'embed viewer', moduleKey: 'zenuml-embed-macro-lite', delegateKind: 'embed', expectedKind: 'embed' },
  ];

  it.each(cases)('$label fires one event labeled $expectedKind', (c) => {
    simulateOrphanReporters(c);

    expect(trackEvent).toHaveBeenCalledTimes(1);
    const props = vi.mocked(trackEvent).mock.calls[0][3] as { diagram_kind: string };
    expect(props.diagram_kind).toBe(c.expectedKind);
    // Regression guard: no mislabeled 'sequence' event on a non-sequence macro.
    if (c.expectedKind !== 'sequence') {
      expect(props.diagram_kind).not.toBe('sequence');
    }
  });

  it('would double-fire (and mislabel) if the shared entry ignored the gate', () => {
    // Reproduces the pre-fix bug: shared entry reports 'sequence' unconditionally
    // AND the graph delegate reports 'graph' → two events, one mislabeled.
    reportOrphanObserved('page-1', 'orphan-1', 'sequence', undefined, { recoveryUsed: false });
    reportOrphanObserved('page-1', 'orphan-1', 'graph', undefined, { recoveryUsed: false });

    expect(trackEvent).toHaveBeenCalledTimes(2);
    const kinds = vi.mocked(trackEvent).mock.calls.map(
      (call) => (call[3] as { diagram_kind: string }).diagram_kind,
    );
    // The gate removes exactly the spurious 'sequence' one for graph loads.
    expect(kinds).toEqual(['sequence', 'graph']);
  });
});
